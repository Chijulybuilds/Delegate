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

    const standup = (await request(app).get('/api/standup').set(auth(maya)).expect(200)).body.brief;
    expect(JSON.stringify(standup)).not.toContain('Confidential: salary review');
    const velocity = (await request(app).get('/api/metrics/velocity').set(auth(maya)).expect(200)).body;
    expect(velocity.rows.every((r: { userId: string }) => r.userId === 'demo-maya' || [...store.tasks.values()].some((t) => t.assigneeId === r.userId && t.createdById === 'demo-maya'))).toBe(true);
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

describe('every day starts with an empty board; earlier days go to History', () => {
  it('moves yesterday’s tasks off Today and into History, where they can still be filtered and opened', async () => {
    const ada = await login('demo-ada');
    const tunde = await login('demo-tunde');
    const today = await createTask(ada, { title: 'Book the venue', assigneeId: 'demo-tunde', priority: 'high' });
    const old = await createTask(ada, { title: 'Order printer toner', assigneeId: 'demo-tunde', priority: 'low' });
    const yesterday = new Date(Date.now() - 30 * 3_600_000).toISOString();
    store.tasks.get(old.id)!.createdAt = yesterday;

    const res = (await request(app).get('/api/tasks').set(auth(tunde)).expect(200)).body;
    expect(res.tasks.map((t: Task) => t.id)).toContain(today.id);
    expect(res.tasks.map((t: Task) => t.id)).not.toContain(old.id);
    expect(res.tasks.every((t: Task) => t.createdAt >= res.day.start)).toBe(true);
    expect(res.day.timezone).toBe('Africa/Lagos');
    expect(res.earlier.unfinished).toBeGreaterThanOrEqual(1);

    const history = async (token: string, query: Record<string, string> = {}) =>
      ((await request(app).get('/api/history').query(query).set(auth(token)).expect(200)).body as { rows: Array<{ task: Task }>; total: number }).rows.map((r) => r.task.id);
    expect(await history(tunde)).toContain(old.id);
    expect(await history(tunde)).not.toContain(today.id);
    expect(await history(tunde, { q: 'toner' })).toEqual([old.id]);
    expect(await history(tunde, { priority: 'high' })).not.toContain(old.id);
    expect(await history(tunde, { status: 'open' })).toContain(old.id);
    expect(await history(tunde, { status: 'approved' })).not.toContain(old.id);
    expect(await history(tunde, { from: new Date(Date.now() - 2 * 86_400_000).toISOString(), to: new Date(Date.now() - 86_400_000 + 3_600_000).toISOString() })).toContain(old.id);

    // Still workable from History.
    await request(app).post(`/api/tasks/${old.id}/transitions`).set(auth(tunde)).send({ action: 'start' }).expect(200);
    // Privacy holds there too.
    expect(await history(await login('demo-maya'))).not.toContain(old.id);
  });
});
