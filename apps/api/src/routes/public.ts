import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { orgForRole, type AppConfig as PublicConfig, type MeResponse } from '@delegate/shared';
import { requireUser } from '../auth/middleware.js';
import { signDemoToken, type UserTokenVerifier } from '../auth/tokens.js';
import type { AppConfig } from '../config.js';
import { HttpError, notFound } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
import type { AccountService } from '../services/account.js';
import type { ProofVerifier } from '../services/ai.js';
import type { WorkspaceService } from '../services/workspace.js';
import { MemoryStore } from '../store/memory.js';
import { DEMO_ORG_INVITE, DEMO_PERSONAS, seedDemo } from '../store/seed.js';
import type { Store } from '../store/types.js';

export function publicRoutes(deps: {
  config: AppConfig;
  store: Store;
  verifier: UserTokenVerifier;
  ai: ProofVerifier;
  workspace: WorkspaceService;
  account: AccountService;
  setupIssue: () => Promise<string | null>;
}) {
  const { config, store, verifier, workspace } = deps;
  const r = Router();
  // Sign-in and joining: 60 tries per 15 minutes per address in production; roomy in development and tests.
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.isProduction ? 60 : 2000, standardHeaders: 'draft-8', legacyHeaders: false });

  r.get('/health', async (_req, res) => {
    const issue = await deps.setupIssue();
    res.status(issue ? 503 : 200).json({ ok: !issue, store: store.kind, authMode: config.authMode, version: config.version, ...(issue ? { setupIssue: issue } : {}) });
  });

  r.get('/config', async (_req, res) => {
    const body: PublicConfig = {
      setupIssue: await deps.setupIssue(),
      authMode: config.authMode,
      supabaseUrl: config.supabase?.url ?? null,
      supabaseAnonKey: config.supabase?.anonKey ?? null,
      aiVerification: deps.ai.enabled,
      version: config.version,
      billing: { stripe: !!config.stripe, paystack: !!config.paystack, demoCheckout: config.simulateProviders },
      integrations: {
        slack: !!config.slack || config.simulateProviders,
        whatsapp: { enabled: !!config.whatsapp || config.simulateProviders, businessNumber: config.whatsapp?.businessNumber ?? null, simulator: config.simulateProviders },
        googleDrive: config.google,
      },
      storage: config.supabase ? 'supabase' : 'api',
      emailOtpLength: config.emailOtpLength,
    };
    res.json(body);
  });

  /* ------------------------- Demo mode (no Supabase) ------------------------ */

  r.get('/auth/demo/personas', (_req, res) => {
    if (config.authMode !== 'demo') throw notFound();
    res.json({
      inviteCode: DEMO_ORG_INVITE,
      personas: DEMO_PERSONAS.map(({ id, fullName, role, title, dept }) => ({ id, fullName, role, title, department: dept })),
    });
  });

  const demoLogin = z.union([
    z.object({ personaId: z.string().min(1) }),
    z.object({ email: z.string().email(), fullName: z.string().trim().min(2).max(80) }),
  ]);

  r.post('/auth/demo', authLimiter, async (req, res) => {
    if (config.authMode !== 'demo') throw notFound();
    const body = demoLogin.parse(req.body);
    let profile;
    if ('personaId' in body) {
      profile = await store.getProfile(body.personaId);
      if (!profile || !DEMO_PERSONAS.some((p) => p.id === body.personaId)) throw notFound('Unknown demo persona');
    } else {
      profile =
        (await store.getProfileByEmail(body.email)) ??
        (await store.upsertProfile({ id: uuid(), email: body.email.toLowerCase(), fullName: body.fullName, avatarUrl: null }));
    }
    const token = await signDemoToken(config, profile);
    res.json({ token });
  });

  r.post('/demo/reset', async (_req, res) => {
    if (!config.allowDemoReset || !(store instanceof MemoryStore)) throw notFound();
    await seedDemo(store);
    res.json({ ok: true });
  });

  /* ------------------------------ Session -------------------------------- */

  const authed = requireUser(store, verifier);

  r.get('/me', authed, async (req, res) => {
    const profile = req.user!;
    const m = await store.getMembershipForUser(profile.id);
    const org = m ? await store.getOrg(m.orgId) : null;
    const body: MeResponse = {
      profile,
      membership: m && org ? { org: orgForRole(org, m.role), role: m.role, departmentId: m.departmentId } : null,
    };
    res.json(body);
  });

  r.post('/onboarding/workspace', authed, authLimiter, async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(2, 'Workspace name is too short').max(60), timezone: z.string().max(64).optional() })
      .parse(req.body);
    const org = await workspace.createWorkspace(req.user!, body);
    res.status(201).json({ org });
  });

  r.post('/onboarding/join', authed, authLimiter, async (req, res) => {
    const body = z.object({ code: z.string().trim().min(4).max(32) }).parse(req.body);
    const org = await workspace.joinWorkspace(req.user!, body.code);
    res.status(201).json({ org: orgForRole(org, 'member') });
  });

  /* ------------------------ Leave workspace / delete account ------------------------ */

  // Not behind requireMember: someone who's no longer in a workspace can still delete their account.
  const notDemoPersona: RequestHandler = (req, _res, next) => {
    if (DEMO_PERSONAS.some((p) => p.id === req.user!.id)) {
      throw new HttpError(400, 'The demo people can’t leave or be deleted. Try it with your own email on the demo sign-in screen.', 'demo_persona');
    }
    next();
  };
  const handover = z.object({ newOwnerId: z.string().min(1).max(64).optional(), deleteWorkspace: z.boolean().optional() });

  r.get('/account/plan', authed, async (req, res) => {
    res.json({ plan: await deps.account.plan(req.user!.id) });
  });

  r.post('/account/leave', authed, authLimiter, notDemoPersona, async (req, res) => {
    const { newOwnerId } = handover.parse(req.body ?? {});
    res.json(await deps.account.leave(req.user!.id, { newOwnerId }));
  });

  r.post('/account/delete', authed, authLimiter, notDemoPersona, async (req, res) => {
    res.json(await deps.account.deleteAccount(req.user!.id, handover.parse(req.body ?? {})));
  });

  return r;
}
