import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LedgerEvent, Task } from '@delegate/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = async (personaId: string) => (await request(app).post('/api/auth/demo').send({ personaId }).expect(200)).body.token as string;
const signUp = async (email: string, fullName: string) => (await request(app).post('/api/auth/demo').send({ email, fullName }).expect(200)).body.token as string;
const meOf = async (token: string) => (await request(app).get('/api/me').set(auth(token)).expect(200)).body;
const createTask = async (token: string, body: Record<string, unknown>) => (await request(app).post('/api/tasks').set(auth(token)).send(body).expect(201)).body.task as Task;
const feed = async (token: string) => (await request(app).get('/api/feed').set(auth(token)).expect(200)).body.events as LedgerEvent[];

/** A new person who joins Lumen (Ada owns it) and gets one task in progress. */
async function joinLumen(email = 'tobi@lumen.example', name = 'Tobi Ade') {
  const token = await signUp(email, name);
  await request(app).post('/api/onboarding/join').set(auth(token)).send({ code: DEMO_ORG_INVITE }).expect(201);
  const userId = (await meOf(token)).profile.id as string;
  return { token, userId };
}

describe('leaving a workspace', () => {
  it('hands unfinished work to the owner and removes access, keeping the sign-in', async () => {
    const ada = await login('demo-ada');
    const tobi = await joinLumen();
    const open = await createTask(ada, { title: 'Reconcile invoices', assigneeId: tobi.userId });
    const done = await createTask(ada, { title: 'Old finished thing', assigneeId: tobi.userId });
    store.tasks.get(done.id)!.status = 'approved';

    const plan = await request(app).get('/api/account/plan').set(auth(tobi.token)).expect(200);
    expect(plan.body.plan).toMatchObject({ role: 'member', orgName: 'Lumen & Co.', openTasks: 1, deletesWorkspace: false });

    const res = await request(app).post('/api/account/leave').set(auth(tobi.token)).send({}).expect(200);
    expect(res.body).toMatchObject({ handedTo: 'demo-ada', tasksHandedOver: 1 });

    expect(store.tasks.get(open.id)!.assigneeId).toBe('demo-ada');
    expect(store.tasks.get(done.id)!.assigneeId).toBe(tobi.userId); // finished work keeps its author
    expect((await meOf(tobi.token)).membership).toBeNull(); // still signed in, no workspace
    await request(app).get('/api/tasks').set(auth(tobi.token)).expect(403);

    const events = await feed(ada);
    expect(events.find((e) => e.type === 'member.left')?.meta).toMatchObject({ name: 'Tobi Ade', toName: 'Ada Okafor', tasks: 1, actorName: 'Tobi Ade' });
    expect(events.find((e) => e.type === 'task.updated' && e.taskId === open.id)?.meta).toMatchObject({ reason: 'member_left', reassigned: { from: tobi.userId, to: 'demo-ada' } });

    // They can join again later.
    await request(app).post('/api/onboarding/join').set(auth(tobi.token)).send({ code: DEMO_ORG_INVITE }).expect(201);
  });

  it('makes an owner hand the workspace to someone else first', async () => {
    const founder = await signUp('founder@acme.example', 'Funmi Founder');
    const org = (await request(app).post('/api/onboarding/workspace').set(auth(founder)).send({ name: 'Acme' }).expect(201)).body.org;
    const hire = await signUp('hire@acme.example', 'Hassan Hire');
    await request(app).post('/api/onboarding/join').set(auth(hire)).send({ code: org.inviteCode }).expect(201);
    const hireId = (await meOf(hire)).profile.id;

    const missing = await request(app).post('/api/account/leave').set(auth(founder)).send({}).expect(400);
    expect(missing.body.error.code).toBe('new_owner_required');
    await request(app).post('/api/account/leave').set(auth(founder)).send({ newOwnerId: 'not-a-member' }).expect(400);

    await request(app).post('/api/account/leave').set(auth(founder)).send({ newOwnerId: hireId }).expect(200);
    expect((await meOf(hire)).membership.role).toBe('owner');
    const transfer = (await feed(hire)).find((e) => e.type === 'member.role_changed');
    expect(transfer?.meta).toMatchObject({ reason: 'ownership_transferred', name: 'Hassan Hire', to: 'owner', actorName: 'Funmi Founder' });
  });

  it('won’t let the last person leave (they delete instead)', async () => {
    const solo = await signUp('solo@one.example', 'Solo Person');
    await request(app).post('/api/onboarding/workspace').set(auth(solo)).send({ name: 'One Person Co' }).expect(201);
    const res = await request(app).post('/api/account/leave').set(auth(solo)).send({}).expect(400);
    expect(res.body.error.code).toBe('last_member');
  });

  it('keeps the shared demo people in place', async () => {
    const tunde = await login('demo-tunde');
    const res = await request(app).post('/api/account/leave').set(auth(tunde)).send({}).expect(400);
    expect(res.body.error.code).toBe('demo_persona');
    await request(app).post('/api/account/delete').set(auth(tunde)).send({}).expect(400);
  });
});

describe('deleting an account', () => {
  it('erases the person and their sign-in, keeps the work, and frees the email', async () => {
    const ada = await login('demo-ada');
    const tobi = await joinLumen();
    const task = await createTask(ada, { title: 'Draft the onboarding guide', assigneeId: tobi.userId });

    await request(app).post('/api/account/delete').set(auth(tobi.token)).send({}).expect(200);

    const profile = store.profiles.get(tobi.userId)!;
    expect(profile).toMatchObject({ fullName: 'Deleted user', avatarUrl: null, phone: null, status: 'suspended' });
    expect(profile.email).toMatch(/@deleted\.invalid$/);
    await request(app).get('/api/me').set(auth(tobi.token)).expect(403); // the old session is dead
    expect(store.tasks.get(task.id)!.assigneeId).toBe('demo-ada');

    // Their name is gone from the history too, other people's names stay.
    const events = await feed(ada);
    const left = events.find((e) => e.type === 'member.left')!;
    expect(left.meta).toMatchObject({ name: 'Deleted user', actorName: 'Deleted user', toName: 'Ada Okafor' });
    expect(events.find((e) => e.type === 'member.joined' && e.actorId === tobi.userId)?.meta.name).toBe('Deleted user');
    expect(JSON.stringify(events)).not.toContain('Tobi Ade');

    // The same email can sign up again as a brand-new person.
    const again = await signUp('tobi@lumen.example', 'Tobi Ade');
    const me = await meOf(again);
    expect(me.profile.id).not.toBe(tobi.userId);
    expect(me.membership).toBeNull();
  });

  it('deletes a one-person workspace with its owner, but never while a paid plan is running', async () => {
    const solo = await signUp('solo@one.example', 'Solo Person');
    const org = (await request(app).post('/api/onboarding/workspace').set(auth(solo)).send({ name: 'One Person Co' }).expect(201)).body.org;
    await createTask(solo, { title: 'Something of mine' });

    const plan = (await request(app).get('/api/account/plan').set(auth(solo)).expect(200)).body.plan;
    expect(plan).toMatchObject({ role: 'owner', others: 0, deletesWorkspace: true, paidPlanActive: false });

    const confirm = await request(app).post('/api/account/delete').set(auth(solo)).send({}).expect(400);
    expect(confirm.body.error.code).toBe('confirm_workspace_deletion');

    Object.assign(store.subscriptions.get(org.id)!, { provider: 'stripe', status: 'active', plan: 'team', cancelAtPeriodEnd: false });
    const paid = await request(app).post('/api/account/delete').set(auth(solo)).send({ deleteWorkspace: true }).expect(409);
    expect(paid.body.error.code).toBe('subscription_active');

    store.subscriptions.get(org.id)!.cancelAtPeriodEnd = true;
    const res = await request(app).post('/api/account/delete').set(auth(solo)).send({ deleteWorkspace: true }).expect(200);
    expect(res.body.deletedWorkspace).toBe(true);
    expect(store.orgs.has(org.id)).toBe(false);
    expect([...store.tasks.values()].some((t) => t.orgId === org.id)).toBe(false);
    expect(store.events.some((e) => e.orgId === org.id)).toBe(false);
  });

  it('works for someone who already left every workspace', async () => {
    const loner = await signUp('loner@x.example', 'Lone Wolf');
    expect((await request(app).get('/api/account/plan').set(auth(loner)).expect(200)).body.plan).toBeNull();
    await request(app).post('/api/account/delete').set(auth(loner)).send({}).expect(200);
    await request(app).get('/api/me').set(auth(loner)).expect(403);
  });
});

describe('removing someone who left the company', () => {
  it('lets a manager take a staff member off and hands their work to that manager', async () => {
    const kemi = await login('demo-kemi'); // manager
    const tobi = await joinLumen();
    const task = await createTask(kemi, { title: 'Design the poster', assigneeId: tobi.userId });

    const res = await request(app).delete(`/api/members/${tobi.userId}`).set(auth(kemi)).expect(200);
    expect(res.body).toMatchObject({ handedTo: 'demo-kemi', tasksHandedOver: 1 });
    expect(store.tasks.get(task.id)!.assigneeId).toBe('demo-kemi');
    expect((await meOf(tobi.token)).membership).toBeNull();
    expect((await feed(kemi)).find((e) => e.type === 'member.left')?.meta).toMatchObject({ reason: 'member_removed', name: 'Tobi Ade', actorName: 'Kemi Adeyemi' });
  });

  it('follows the chain of command', async () => {
    const ada = await login('demo-ada');
    const kemi = await login('demo-kemi');
    const tunde = await login('demo-tunde');
    await request(app).delete('/api/members/demo-maya').set(auth(tunde)).expect(403); // staff can't
    await request(app).delete('/api/members/demo-ada').set(auth(kemi)).expect(403); // nobody removes the owner
    await request(app).delete('/api/members/demo-kemi').set(auth(kemi)).expect(400); // use Leave for yourself
    const other = await signUp('mgr2@lumen.example', 'Second Manager');
    await request(app).post('/api/onboarding/join').set(auth(other)).send({ code: DEMO_ORG_INVITE }).expect(201);
    const otherId = (await meOf(other)).profile.id;
    await request(app).patch(`/api/members/${otherId}`).set(auth(ada)).send({ role: 'manager' }).expect(200);
    await request(app).delete(`/api/members/${otherId}`).set(auth(kemi)).expect(403); // only the owner removes managers
    await request(app).delete(`/api/members/${otherId}`).set(auth(ada)).expect(200);
  });
});
