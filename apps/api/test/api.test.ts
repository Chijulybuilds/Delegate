import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '@delegate/shared';
import { createApp } from '../src/app.js';
import { DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, loadConfig } from '../src/config.js';
import type { ProofVerifier } from '../src/services/ai.js';
import { MemoryStore } from '../src/store/memory.js';
import { DEMO_ORG_INVITE, seedDemo } from '../src/store/seed.js';

const config = loadConfig({ NODE_ENV: 'test', SUPABASE_URL: '', ADMIN_EMAIL: '', CRON_SECRET: 'cron-test-secret' });

let store: MemoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  store = new MemoryStore();
  await seedDemo(store);
  app = createApp({ config, store });
});

async function login(personaId: string) {
  const res = await request(app).post('/api/auth/demo').send({ personaId }).expect(200);
  return res.body.token as string;
}

async function newUser(email: string, fullName: string) {
  const res = await request(app).post('/api/auth/demo').send({ email, fullName }).expect(200);
  return res.body.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createTask(token: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/tasks').set(auth(token)).send(body).expect(201);
  return res.body.task as Task;
}

describe('public endpoints', () => {
  it('reports demo mode when Supabase is not configured', async () => {
    const res = await request(app).get('/api/config').expect(200);
    expect(res.body.authMode).toBe('demo');
    expect(res.body.supabaseAnonKey).toBeNull();
  });

  it('rejects workspace routes without a token', async () => {
    await request(app).get('/api/tasks').expect(401);
  });

  it('returns JSON 404 for unknown API routes (401 first when anonymous)', async () => {
    await request(app).get('/api/nope').expect(401);
    const token = await login('demo-ada');
    const res = await request(app).get('/api/nope').set(auth(token)).expect(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('task lifecycle: red → amber → green → blue', () => {
  it('runs the full accountability loop with proof of work and an audit', async () => {
    const ada = await login('demo-ada'); // owner
    const tunde = await login('demo-tunde'); // staff

    const task = await createTask(ada, { title: 'Ship release notes', assigneeId: 'demo-tunde', priority: 'high' });
    expect(task.status).toBe('open');

    // Staff starts (red → amber)
    let res = await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'start' }).expect(200);
    expect(res.body.task.status).toBe('in_progress');

    // Proof is mandatory to go green
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'submit', proofs: [] }).expect(400);
    await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(tunde))
      .send({ action: 'submit', proofs: [{ kind: 'link', url: 'javascript:alert(1)' }] })
      .expect(400);

    res = await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(tunde))
      .send({ action: 'submit', proofs: [{ kind: 'link', url: 'https://example.com/notes' }, { kind: 'note', note: 'Published to the blog' }] })
      .expect(200);
    expect(res.body.task.status).toBe('done');
    expect(res.body.proofs).toHaveLength(2);

    // Staff cannot audit
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'approve' }).expect(403);

    // Manager audits (green → blue)
    res = await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(ada)).send({ action: 'approve' }).expect(200);
    expect(res.body.task.status).toBe('approved');
    expect(res.body.task.approvedById).toBe('demo-ada');

    // Immutable ledger recorded every step in order
    const types = res.body.events.map((e: { type: string }) => e.type).reverse();
    expect(types).toEqual(['task.created', 'task.started', 'task.submitted', 'task.approved']);

    // Audited tasks are terminal
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(ada)).send({ action: 'start' }).expect(409);
  });

  it('lets a manager request changes, sending the task back to amber with a comment', async () => {
    const ada = await login('demo-ada');
    const maya = await login('demo-maya');
    const task = await createTask(ada, { title: 'Draft vendor email', assigneeId: 'demo-maya' });
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(maya)).send({ action: 'start' }).expect(200);
    await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(maya))
      .send({ action: 'submit', proofs: [{ kind: 'note', note: 'Draft in shared drive' }] })
      .expect(200);
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(ada)).send({ action: 'request_changes' }).expect(400);
    const res = await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(ada))
      .send({ action: 'request_changes', comment: 'Add the delivery window' })
      .expect(200);
    expect(res.body.task.status).toBe('in_progress');
    expect(res.body.task.submittedAt).toBeNull();
    expect(res.body.comments.at(-1).body).toBe('Add the delivery window');
  });

  it('flags a blocker with a reason and the teammate it waits on', async () => {
    const ada = await login('demo-ada');
    const leo = await login('demo-leo');
    const task = await createTask(ada, { title: 'Wire payments webhook', assigneeId: 'demo-leo' });
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(leo)).send({ action: 'block' }).expect(400);
    const res = await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(leo))
      .send({ action: 'block', reason: 'Need API keys from finance', waitingOnId: 'demo-kemi' })
      .expect(200);
    expect(res.body.task.status).toBe('blocked');
    expect(res.body.task.waitingOnId).toBe('demo-kemi');

    const unblocked = await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(leo)).send({ action: 'unblock' }).expect(200);
    expect(unblocked.body.task.status).toBe('in_progress');
    expect(unblocked.body.task.blockedReason).toBeNull();
  });

  it('attaches AI verification verdicts to submitted proof when enabled', async () => {
    const ai: ProofVerifier = { enabled: true, check: async () => ({ verdict: 'pass', reason: 'Link matches the task.' }) };
    app = createApp({ config, store, ai });
    const ada = await login('demo-ada');
    const sara = await login('demo-sara');
    const task = await createTask(ada, { title: 'Export logo pack', assigneeId: 'demo-sara' });
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(sara)).send({ action: 'start' }).expect(200);
    const res = await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(sara))
      .send({ action: 'submit', proofs: [{ kind: 'link', url: 'https://drive.example.com/logos' }] })
      .expect(200);
    expect(res.body.proofs[0].aiVerdict).toBe('pass');
    const board = await request(app).get('/api/tasks').set(auth(ada)).expect(200);
    expect(board.body.aiVerdicts[task.id]).toBe('pass');
  });
});

describe('permissions', () => {
  it('only managers can assign work to teammates', async () => {
    const tunde = await login('demo-tunde');
    await request(app).post('/api/tasks').set(auth(tunde)).send({ title: 'Do my own thing' }).expect(201);
    await request(app).post('/api/tasks').set(auth(tunde)).send({ title: 'Do their thing', assigneeId: 'demo-maya' }).expect(403);
  });

  it('only the assignee can submit proof', async () => {
    const ada = await login('demo-ada');
    const maya = await login('demo-maya');
    const task = await createTask(ada, { title: 'Count inventory', assigneeId: 'demo-tunde' });
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(ada)).send({ action: 'start' }).expect(200);
    await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(maya))
      .send({ action: 'submit', proofs: [{ kind: 'note', note: 'done done' }] })
      .expect(403);
  });

  it('enforces four-eyes: a manager cannot audit their own work', async () => {
    const kemi = await login('demo-kemi'); // manager, not owner
    const ada = await login('demo-ada');
    const task = await createTask(kemi, { title: 'Brief the agency' });
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(kemi)).send({ action: 'start' }).expect(200);
    await request(app)
      .post(`/api/tasks/${task.id}/transitions`)
      .set(auth(kemi))
      .send({ action: 'submit', proofs: [{ kind: 'note', note: 'Briefed on call' }] })
      .expect(200);
    const res = await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(kemi)).send({ action: 'approve' }).expect(403);
    expect(res.body.error.message).toMatch(/own work/);
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(ada)).send({ action: 'approve' }).expect(200);
  });

  it('isolates tenants: another workspace cannot read Lumen tasks', async () => {
    const ada = await login('demo-ada');
    const lumenTask = await createTask(ada, { title: 'Confidential plan' });

    const outsider = await newUser('founder@other.example', 'Other Founder');
    await request(app).get('/api/tasks').set(auth(outsider)).expect(403); // no workspace yet
    await request(app).post('/api/onboarding/workspace').set(auth(outsider)).send({ name: 'Other Co' }).expect(201);

    const board = await request(app).get('/api/tasks').set(auth(outsider)).expect(200);
    expect(board.body.tasks).toHaveLength(0);
    await request(app).get(`/api/tasks/${lumenTask.id}`).set(auth(outsider)).expect(404);
    await request(app).post(`/api/tasks/${lumenTask.id}/transitions`).set(auth(outsider)).send({ action: 'start' }).expect(404);
  });

  it('joins a workspace with an invite code as a member', async () => {
    const newbie = await newUser('new.hire@lumen.example', 'New Hire');
    await request(app).post('/api/onboarding/join').set(auth(newbie)).send({ code: 'WRONG-CODE' }).expect(404);
    await request(app).post('/api/onboarding/join').set(auth(newbie)).send({ code: DEMO_ORG_INVITE.toLowerCase() }).expect(201);
    const me = await request(app).get('/api/me').set(auth(newbie)).expect(200);
    expect(me.body.membership.role).toBe('member');
    expect(me.body.membership.org.name).toBe('Lumen & Co.');
  });
});

describe('metrics', () => {
  it('computes velocity and the standup brief from the ledger', async () => {
    const ada = await login('demo-ada');
    const velocity = await request(app).get('/api/metrics/velocity?days=14').set(auth(ada)).expect(200);
    expect(velocity.body.rows.length).toBe(6);
    expect(velocity.body.team.completed).toBeGreaterThan(5);
    expect(velocity.body.daily).toHaveLength(14);

    const standup = await request(app).get('/api/standup').set(auth(ada)).expect(200);
    expect(standup.body.brief.blockers.length).toBe(2);
    expect(standup.body.text).toContain('Blockers (2)');
  });

  it('serves a heartbeat feed newest first', async () => {
    const ada = await login('demo-ada');
    const res = await request(app).get('/api/feed?limit=5').set(auth(ada)).expect(200);
    expect(res.body.events).toHaveLength(5);
    const times = res.body.events.map((e: { createdAt: string }) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('platform admin (/admin)', () => {
  it('requires the separate admin credentials', async () => {
    await request(app).post('/api/admin/login').send({ email: DEV_ADMIN_EMAIL, password: 'wrong' }).expect(401);
    await request(app).get('/api/admin/overview').expect(401);

    // A workspace owner's token is not an admin token.
    const ada = await login('demo-ada');
    await request(app).get('/api/admin/overview').set(auth(ada)).expect(401);

    const res = await request(app).post('/api/admin/login').send({ email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD }).expect(200);
    const admin = res.body.token as string;
    const overview = await request(app).get('/api/admin/overview').set(auth(admin)).expect(200);
    expect(overview.body.totals.organizations).toBe(1);
    expect(overview.body.totals.users).toBe(6);

    // And an admin token cannot act inside a workspace.
    await request(app).get('/api/tasks').set(auth(admin)).expect(401);
  });

  it('suspends a workspace, locking its members out', async () => {
    const login = await request(app).post('/api/admin/login').send({ email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD });
    const admin = login.body.token as string;
    const { body } = await request(app).get('/api/admin/orgs').set(auth(admin)).expect(200);
    const orgId = body.orgs[0].id;
    await request(app).patch(`/api/admin/orgs/${orgId}`).set(auth(admin)).send({ status: 'suspended' }).expect(200);

    const tokenRes = await request(app).post('/api/auth/demo').send({ personaId: 'demo-tunde' });
    const res = await request(app).get('/api/tasks').set(auth(tokenRes.body.token)).expect(403);
    expect(res.body.error.message).toMatch(/suspended/);
  });
});

describe('cron', () => {
  it('rejects a bad secret and compiles briefs with the right one', async () => {
    await request(app).post('/api/cron/standup').set('x-cron-secret', 'nope').expect(401);
    const res = await request(app).post('/api/cron/standup').set('x-cron-secret', 'cron-test-secret').expect(200);
    expect(res.body.workspaces).toBe(1);
  });
});

describe('sign-in never fails silently', () => {
  it('names a missing migration on /config and on every API call until it is fixed', async () => {
    const issue = 'The Supabase database is missing the latest migration: run supabase/migrations/20261113000000_saas.sql.';
    const halfMigrated = Object.assign(store, { checkSchema: async () => issue });
    const guarded = createApp({ config, store: halfMigrated });

    const cfg = await request(guarded).get('/api/config').expect(200);
    expect(cfg.body.setupIssue).toBe(issue);
    const health = await request(guarded).get('/api/health').expect(503);
    expect(health.body).toMatchObject({ ok: false, setupIssue: issue });
    // Sign-in (and everything after it) explains itself instead of failing as an anonymous 500.
    const res = await request(guarded).post('/api/auth/demo').send({ personaId: 'demo-ada' }).expect(503);
    expect(res.body.error).toEqual({ code: 'setup_incomplete', message: issue });
  });

  it('reports no setup issue for a healthy database', async () => {
    const healthy = Object.assign(store, { checkSchema: async () => null });
    const res = await request(createApp({ config, store: healthy })).get('/api/config').expect(200);
    expect(res.body.setupIssue).toBeNull();
  });

  it('explains why the API could not start', async () => {
    const { describeStartupError } = await import('../src/lib/startup.js');
    const missing = Object.assign(new Error("Cannot find package 'stripe' imported from /app/dist/chunk.js"), { code: 'ERR_MODULE_NOT_FOUND' });
    expect(describeStartupError(missing, 'dev')).toMatch(/package "stripe" isn't installed.*npm install/);
    expect(describeStartupError(new Error('APP_ENCRYPTION_KEY is required in production'), 'vercel')).toMatch(/Vercel → Project → Settings → Environment Variables/);
  });
});
