import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppConfig as PublicConfig, MeResponse } from '@delegate/shared';
import { requireUser } from '../auth/middleware.js';
import { signDemoToken, type UserTokenVerifier } from '../auth/tokens.js';
import type { AppConfig } from '../config.js';
import { notFound } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
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
}) {
  const { config, store, verifier, workspace } = deps;
  const r = Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

  r.get('/health', (_req, res) => {
    res.json({ ok: true, store: store.kind, authMode: config.authMode, version: config.version });
  });

  r.get('/config', (_req, res) => {
    const body: PublicConfig = {
      authMode: config.authMode,
      supabaseUrl: config.supabase?.url ?? null,
      supabaseAnonKey: config.supabase?.anonKey ?? null,
      aiVerification: deps.ai.enabled,
      version: config.version,
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
      membership: m && org ? { org, role: m.role, departmentId: m.departmentId } : null,
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
    res.status(201).json({ org });
  });

  return r;
}
