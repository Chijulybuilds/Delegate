import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireAdmin } from '../auth/middleware.js';
import { signAdminToken } from '../auth/tokens.js';
import type { AppConfig } from '../config.js';
import { HttpError, notFound, unauthorized } from '../lib/errors.js';
import type { AdminService } from '../services/admin.js';
import type { Mailer } from '../services/mail.js';
import { standupToText, type MetricsService } from '../services/metrics.js';
import type { Store } from '../store/types.js';

const sha = (s: string) => createHash('sha256').update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

async function passwordMatches(config: NonNullable<AppConfig['admin']>, password: string) {
  if (config.passwordHash) return bcrypt.compare(password, config.passwordHash);
  if (config.password) return safeEqual(password, config.password);
  return false;
}

export function adminRoutes(deps: { config: AppConfig; admin: AdminService }) {
  const { config, admin } = deps;
  const r = Router();

  // Brute-force protection: 10 attempts per 15 minutes per IP.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Try again in 15 minutes.' } },
  });

  r.post('/login', loginLimiter, async (req, res) => {
    if (!config.admin) throw notFound();
    const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const emailOk = safeEqual(body.email.trim().toLowerCase(), config.admin.email);
    const passOk = await passwordMatches(config.admin, body.password);
    if (!emailOk || !passOk) throw unauthorized('Invalid admin credentials');
    const token = await signAdminToken(config, config.admin.email);
    res.json({ token, email: config.admin.email, expiresInHours: 8 });
  });

  r.use(requireAdmin(config));

  r.get('/session', (req, res) => {
    res.json({ email: req.admin!.email });
  });

  r.get('/overview', async (_req, res) => {
    res.json(await admin.overview());
  });

  r.get('/orgs', async (_req, res) => {
    res.json({ orgs: await admin.orgs() });
  });

  r.patch('/orgs/:id', async (req, res) => {
    const body = z
      .object({ status: z.enum(['active', 'suspended']).optional(), plan: z.enum(['starter', 'team', 'enterprise']).optional() })
      .parse(req.body);
    let org;
    if (body.status) org = await admin.setOrgStatus(String(req.params.id), body.status);
    if (body.plan) org = await admin.setOrgPlan(String(req.params.id), body.plan);
    res.json({ org });
  });

  r.get('/users', async (_req, res) => {
    res.json({ users: await admin.users() });
  });

  r.patch('/users/:id', async (req, res) => {
    const body = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
    await admin.setUserStatus(String(req.params.id), body.status);
    res.json({ ok: true });
  });

  r.get('/ledger', async (req, res) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(100), before: z.string().datetime({ offset: true }).optional() })
      .parse(req.query);
    res.json({ events: await admin.ledger(q.limit, q.before) });
  });

  return r;
}

/** Scheduled jobs (e.g. Vercel Cron or a crontab curl). Guarded by CRON_SECRET. */
export function cronRoutes(deps: { config: AppConfig; store: Store; metrics: MetricsService; mailer: Mailer }) {
  const { config, store, metrics, mailer } = deps;
  const r = Router();

  r.post('/standup', async (req, res) => {
    if (!config.cronSecret) throw notFound();
    const provided = req.headers['x-cron-secret'] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof provided !== 'string' || !safeEqual(provided, config.cronSecret)) throw new HttpError(401, 'Bad cron secret', 'unauthorized');

    const orgs = (await store.listOrgs()).filter((o) => o.status === 'active');
    let sent = 0;
    for (const org of orgs) {
      const brief = await metrics.standup(org.id);
      const recipients = (await store.listMembers(org.id))
        .filter((m) => m.role === 'owner' || m.role === 'manager')
        .map((m) => m.email)
        .filter(Boolean);
      if (await mailer.send({ to: recipients, subject: `${org.name} · Standup for ${brief.date}`, text: standupToText(brief) })) sent++;
    }
    res.json({ workspaces: orgs.length, emailed: sent, mailEnabled: mailer.enabled });
  });

  return r;
}
