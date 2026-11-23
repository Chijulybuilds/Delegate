import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditsResponse, LedgerEvent, Task } from '@delegate/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/store/memory.js';
import { seedDemo } from '../src/store/seed.js';

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
const createTask = async (token: string, body: Record<string, unknown>) => (await request(app).post('/api/tasks').set(auth(token)).send(body).expect(201)).body.task as Task;
const board = async (token: string) => (await request(app).get('/api/tasks').set(auth(token)).expect(200)).body.tasks as Task[];

describe('who sees which tasks', () => {
  it('the owner sees everything; everyone else only the work that involves them', async () => {
    const ada = await login('demo-ada'); // owner
    const kemi = await login('demo-kemi'); // manager
    const tunde = await login('demo-tunde'); // staff
    const maya = await login('demo-maya'); // staff

    const forTunde = await createTask(ada, { title: 'Owner → Tunde', assigneeId: 'demo-tunde' });
    const kemiToMaya = await createTask(kemi, { title: 'Kemi → Maya', assigneeId: 'demo-maya' });

    const everything = await board(ada);
    expect(everything.map((t) => t.id)).toEqual(expect.arrayContaining([forTunde.id, kemiToMaya.id]));
    expect(everything.every((t) => t.orgId === forTunde.orgId)).toBe(true);

    const tundes = await board(tunde);
    expect(tundes.length).toBeGreaterThan(0);
    expect(tundes.every((t) => t.assigneeId === 'demo-tunde' || t.createdById === 'demo-tunde' || t.waitingOnId === 'demo-tunde')).toBe(true);
    expect(tundes.some((t) => t.id === kemiToMaya.id)).toBe(false);

    // A manager sees what they handed out, not other people's work.
    const kemis = await board(kemi);
    expect(kemis.some((t) => t.id === kemiToMaya.id)).toBe(true);
    expect(kemis.some((t) => t.id === forTunde.id)).toBe(false);

    // Direct links and actions on hidden tasks look exactly like a missing task.
    await request(app).get(`/api/tasks/${forTunde.id}`).set(auth(maya)).expect(404);
    await request(app).post(`/api/tasks/${forTunde.id}/comments`).set(auth(maya)).send({ body: 'peek' }).expect(404);
    await request(app).get(`/api/tasks/${kemiToMaya.id}`).set(auth(maya)).expect(200);
  });

  it('someone a blocker waits on can open that task, and only while it waits on them', async () => {
    const ada = await login('demo-ada');
    const tunde = await login('demo-tunde');
    const leo = await login('demo-leo');
    const task = await createTask(ada, { title: 'Wire the payments webhook', assigneeId: 'demo-tunde' });
    await request(app).get(`/api/tasks/${task.id}`).set(auth(leo)).expect(404);
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'block', reason: 'Need the signing secret', waitingOnId: 'demo-leo' }).expect(200);
    await request(app).get(`/api/tasks/${task.id}`).set(auth(leo)).expect(200);
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(tunde)).send({ action: 'unblock' }).expect(200);
    await request(app).get(`/api/tasks/${task.id}`).set(auth(leo)).expect(404);
  });

  it('activity and insights only show what the viewer may see', async () => {
    const ada = await login('demo-ada');
    const maya = await login('demo-maya');
    const secret = await createTask(ada, { title: 'Confidential: salary review', assigneeId: 'demo-tunde' });

    const mayaFeed = (await request(app).get('/api/feed').set(auth(maya)).expect(200)).body.events as LedgerEvent[];
    expect(mayaFeed.some((e) => e.taskId === secret.id)).toBe(false);
    const visible = new Set((await board(maya)).map((t) => t.id));
    expect(mayaFeed.every((e) => (e.taskId ? visible.has(e.taskId) || store.tasks.get(e.taskId)!.assigneeId === 'demo-maya' : e.actorId === 'demo-maya'))).toBe(true);
    const adaFeed = (await request(app).get('/api/feed').set(auth(ada)).expect(200)).body.events as LedgerEvent[];
    expect(adaFeed.some((e) => e.taskId === secret.id)).toBe(true);

    await request(app).get('/api/standup').set(auth(maya)).expect(403);
    // Insights compare teammates: only the owner sees them.
    await request(app).get('/api/metrics/velocity').set(auth(maya)).expect(403);
  });
});

describe('all-time audits (owner only)', () => {
  async function auditedTask(owner: string, assignee: string, assigneeToken: string, body: Record<string, unknown>) {
    const task = await createTask(owner, { ...body, assigneeId: assignee });
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(assigneeToken)).send({ action: 'start' }).expect(200);
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(assigneeToken)).send({ action: 'submit', proofs: [{ kind: 'note', note: 'Done and documented' }] }).expect(200);
    await request(app).post(`/api/tasks/${task.id}/transitions`).set(auth(owner)).send({ action: 'approve' }).expect(200);
    return task;
  }

  it('is closed to everyone but the owner', async () => {
    for (const persona of ['demo-kemi', 'demo-tunde']) {
      const res = await request(app).get('/api/audits').set(auth(await login(persona))).expect(403);
      expect(res.body.error.message).toMatch(/owner/);
      await request(app).get('/api/audits/export').set(auth(await login(persona))).expect(403);
    }
  });

  it('lists every audited task, newest first, and filters by name, priority and date', async () => {
    const ada = await login('demo-ada');
    const tunde = await login('demo-tunde');
    const maya = await login('demo-maya');
    const urgent = await auditedTask(ada, 'demo-tunde', tunde, { title: 'Renew SSL certificates', priority: 'urgent' });
    const low = await auditedTask(ada, 'demo-maya', maya, { title: 'Tidy the shared drive', priority: 'low' });
    // An old audit, from last year.
    store.tasks.get(low.id)!.approvedAt = '2025-03-02T10:00:00.000Z';

    const all = (await request(app).get('/api/audits').set(auth(ada)).expect(200)).body as AuditsResponse;
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.rows[0]!.task.id).toBe(urgent.id); // newest first
    expect(all.rows.every((r) => r.task.status === 'approved')).toBe(true);
    expect(all.rows.find((r) => r.task.id === urgent.id)).toMatchObject({ assigneeName: 'Tunde Bakare', auditorName: 'Ada Okafor' });

    const get = async (query: Record<string, string>) => ((await request(app).get('/api/audits').query(query).set(auth(ada)).expect(200)).body as AuditsResponse).rows.map((r) => r.task.id);
    expect(await get({ q: 'tunde ssl' })).toEqual([urgent.id]); // person's name + words from the title
    expect(await get({ q: `DLG-${urgent.seq}` })).toEqual([urgent.id]);
    expect(await get({ assigneeId: 'demo-maya' })).toContain(low.id);
    expect(await get({ assigneeId: 'demo-maya' })).not.toContain(urgent.id);
    expect(await get({ priority: 'urgent' })).toContain(urgent.id);
    expect(await get({ priority: 'urgent' })).not.toContain(low.id);
    expect(await get({ from: '2025-03-01T00:00:00.000Z', to: '2025-03-03T00:00:00.000Z' })).toEqual([low.id]);
    expect(await get({ from: new Date(Date.now() - 3_600_000).toISOString() })).not.toContain(low.id);

    const csv = await request(app).get('/api/audits/export').query({ priority: 'urgent' }).set(auth(ada)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('"Renew SSL certificates"');
    expect(csv.text).not.toContain('Tidy the shared drive');
  });
});

describe('every day starts with an empty board; earlier days wait on the owner', () => {
  it('moves yesterday’s tasks off Today and onto the owner’s "Waiting on me", filterable by day and time', async () => {
    const ada = await login('demo-ada');
    const tunde = await login('demo-tunde');
    const today = await createTask(ada, { title: 'Book the venue', assigneeId: 'demo-tunde', priority: 'high' });
    const old = await createTask(ada, { title: 'Order printer toner', assigneeId: 'demo-tunde', priority: 'low' });
    // Given out yesterday at 09:30 Lagos time (08:30 UTC).
    const y = new Date(Date.now() - 86_400_000);
    store.tasks.get(old.id)!.createdAt = `${y.toISOString().slice(0, 10)}T08:30:00.000Z`;

    const staffBoard = (await request(app).get('/api/tasks').set(auth(tunde)).expect(200)).body;
    expect(staffBoard.tasks.map((t: Task) => t.id)).toContain(today.id);
    expect(staffBoard.tasks.map((t: Task) => t.id)).not.toContain(old.id);
    expect(staffBoard.tasks.every((t: Task) => t.createdAt >= staffBoard.day.start)).toBe(true);
    expect(staffBoard.day.timezone).toBe('Africa/Lagos');
    expect(staffBoard.earlier.unfinished).toBeGreaterThanOrEqual(1); // their own unfinished work from earlier days
    expect(staffBoard.earlier.awaitingAudit).toBe(0); // staff don't audit

    const ownerBoard = (await request(app).get('/api/tasks').set(auth(ada)).expect(200)).body;
    expect(ownerBoard.earlier.unfinished).toBeGreaterThanOrEqual(1);

    // Everyone looks back at their own work; only the owner sees everyone's.
    const mine = (await request(app).get('/api/history').set(auth(tunde)).expect(200)).body as { rows: Array<{ task: Task }> };
    expect(mine.rows.map((r) => r.task.id)).toContain(old.id);
    expect(mine.rows.every((r) => r.task.assigneeId === 'demo-tunde' || r.task.createdById === 'demo-tunde' || r.task.waitingOnId === 'demo-tunde')).toBe(true);
    const maya = (await request(app).get('/api/history').set(auth(await login('demo-maya'))).expect(200)).body as { rows: Array<{ task: Task }> };
    expect(maya.rows.some((r) => r.task.id === old.id)).toBe(false);
    expect(maya.rows.length).toBeGreaterThan(0);

    const history = async (query: Record<string, string> = {}) =>
      ((await request(app).get('/api/history').query(query).set(auth(ada)).expect(200)).body as { rows: Array<{ task: Task }>; total: number }).rows.map((r) => r.task.id);
    expect(await history()).toContain(old.id);
    expect(await history()).not.toContain(today.id);
    expect(await history({ q: 'toner' })).toEqual([old.id]);
    expect(await history({ priority: 'high' })).not.toContain(old.id);
    expect(await history({ status: 'open' })).toContain(old.id);
    expect(await history({ status: 'approved' })).not.toContain(old.id);
    const dayStart = new Date(`${y.toISOString().slice(0, 10)}T00:00:00+01:00`);
    expect(await history({ from: dayStart.toISOString(), to: new Date(dayStart.getTime() + 86_400_000).toISOString() })).toContain(old.id);
    // Time of day, in the workspace's time zone (09:30 Lagos).
    expect(await history({ fromTime: '09:00', toTime: '10:00' })).toContain(old.id);
    expect(await history({ fromTime: '10:00', toTime: '12:00' })).not.toContain(old.id);
    expect(await history({ fromTime: '09:31' })).not.toContain(old.id);
    await request(app).get('/api/history').query({ fromTime: '9am' }).set(auth(ada)).expect(400);
    // The board view asks for many at once.
    const big = (await request(app).get('/api/history').query({ pageSize: '500' }).set(auth(ada)).expect(200)).body;
    expect(big.pageSize).toBe(500);

    // The assignee can still open and finish it (e.g. from a notification).
    await request(app).get(`/api/tasks/${old.id}`).set(auth(tunde)).expect(200);
    await request(app).post(`/api/tasks/${old.id}/transitions`).set(auth(tunde)).send({ action: 'start' }).expect(200);
  });
});

describe('invite codes belong to the owner', () => {
  it('only the owner sees the code or makes a new one', async () => {
    const ada = await login('demo-ada');
    const kemi = await login('demo-kemi');
    const tunde = await login('demo-tunde');

    const owner = (await request(app).get('/api/workspace').set(auth(ada)).expect(200)).body.org.inviteCode;
    expect(owner).toBe('LUMEN-2026');
    for (const token of [kemi, tunde]) {
      expect((await request(app).get('/api/workspace').set(auth(token)).expect(200)).body.org.inviteCode).toBe('');
      expect((await request(app).get('/api/me').set(auth(token)).expect(200)).body.membership.org.inviteCode).toBe('');
      expect(JSON.stringify((await request(app).get('/api/workspace').set(auth(token))).body)).not.toContain('LUMEN-2026');
    }
    // Managers can still change other settings, but not the invite code.
    await request(app).patch('/api/workspace').set(auth(kemi)).send({ regenerateInvite: true }).expect(403);
    const settings = await request(app).patch('/api/workspace').set(auth(kemi)).send({ timezone: 'Africa/Lagos' }).expect(200);
    expect(settings.body.org.inviteCode).toBe('');

    const fresh = (await request(app).patch('/api/workspace').set(auth(ada)).send({ regenerateInvite: true }).expect(200)).body.org.inviteCode;
    expect(fresh).toMatch(/^[A-Z]+-[A-Z0-9]{4}$/);
    expect(fresh).not.toBe(owner);

    // Someone joining gets in, but doesn't get the code back.
    const joiner = (await request(app).post('/api/auth/demo').send({ email: 'new@lumen.example', fullName: 'New Person' }).expect(200)).body.token;
    const joined = await request(app).post('/api/onboarding/join').set(auth(joiner)).send({ code: fresh }).expect(201);
    expect(joined.body.org.inviteCode).toBe('');
  });
});
