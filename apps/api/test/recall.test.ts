import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardResponse, LedgerEvent, Task } from '@delegate/shared';
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
const board = async (token: string) => (await request(app).get('/api/tasks').set(auth(token)).expect(200)).body as BoardResponse;
/** An earlier task by words in its title (as the owner sees History). */
async function earlier(owner: string, q: string) {
  const rows = (await request(app).get('/api/history').query({ q }).set(auth(owner)).expect(200)).body.rows as Array<{ task: Task }>;
  expect(rows).toHaveLength(1);
  return rows[0]!.task;
}

describe('recall: bring an earlier task back to today', () => {
  it('the owner can recall anything, even an audited task; the original keeps its history', async () => {
    const ada = await login('demo-ada');
    const audited = await earlier(ada, 'SSL certificates'); // Leo's, audited days ago
    expect(audited.status).toBe('approved');

    const res = await request(app).post(`/api/tasks/${audited.id}/recall`).set(auth(ada)).send({}).expect(201);
    const copy = res.body.task as Task;
    expect(copy).toMatchObject({ title: audited.title, status: 'open', assigneeId: 'demo-leo', createdById: 'demo-ada', recalledFromId: audited.id, priority: audited.priority });
    expect(copy.id).not.toBe(audited.id);

    // It's on today's board; the original is still audited, now pointing at the copy.
    expect((await board(ada)).tasks.map((t) => t.id)).toContain(copy.id);
    expect(store.tasks.get(audited.id)).toMatchObject({ status: 'approved', recalledToId: copy.id });

    // It has left History entirely: only the copy, on today's board, carries on.
    const history = (await request(app).get('/api/history').set(auth(ada)).expect(200)).body.rows as Array<{ task: Task }>;
    expect(history.map((r) => r.task.id)).not.toContain(audited.id);

    // Once is enough: recall the new one if it needs another day.
    const again = await request(app).post(`/api/tasks/${audited.id}/recall`).set(auth(ada)).send({}).expect(409);
    expect(again.body.error.message).toContain(`DLG-${copy.seq}`);
    // Today's tasks can't be recalled.
    await request(app).post(`/api/tasks/${copy.id}/recall`).set(auth(ada)).send({}).expect(400);

    // The history says what happened, and Leo hears about it.
    const events = (await request(app).get('/api/feed').set(auth(ada)).expect(200)).body.events as LedgerEvent[];
    expect(events.find((e) => e.type === 'task.recalled' && e.taskId === audited.id)?.meta).toMatchObject({ toTaskId: copy.id, toRef: `DLG-${copy.seq}` });
    expect(events.find((e) => e.type === 'task.created' && e.taskId === copy.id)?.meta).toMatchObject({ recalledFrom: audited.id });
    const leo = (await request(app).get('/api/notifications').set(auth(await login('demo-leo'))).expect(200)).body;
    expect(leo.tasks[copy.id]).toBeTruthy();
  });

  it('the owner can hand the recalled task to someone else, with a new due time and a note', async () => {
    const ada = await login('demo-ada');
    const cve = await earlier(ada, 'CVE'); // Tunde's, never started
    const due = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const res = await request(app).post(`/api/tasks/${cve.id}/recall`).set(auth(ada)).send({ assigneeId: 'demo-leo', dueAt: due, note: 'Leo, please take this one today.' }).expect(201);
    expect(res.body.task).toMatchObject({ assigneeId: 'demo-leo', dueAt: due });
    const detail = (await request(app).get(`/api/tasks/${res.body.task.id}`).set(auth(ada)).expect(200)).body;
    expect(detail.comments[0].body).toBe('Leo, please take this one today.');
    // It no longer counts as left over from earlier days (the blocked SSO task is counted as blocked).
    const b = await board(ada);
    expect(b.earlier.unfinished).toBe(0);
    expect(b.blocked.map((t) => t.title)).toContain('Integrate SSO for enterprise pilot');
  });

  it('staff recall their own unfinished work to themselves, and nothing else', async () => {
    const ada = await login('demo-ada');
    const tunde = await login('demo-tunde');
    const sso = await earlier(ada, 'SSO'); // Tunde's, blocked yesterday
    const ssl = await earlier(ada, 'Migrate staging'); // Tunde's, audited
    const crm = await earlier(ada, 'CRM duplicate'); // Maya's

    // His own audited task: no. Someone else's: he can't even see it.
    await request(app).post(`/api/tasks/${ssl.id}/recall`).set(auth(tunde)).send({}).expect(403);
    await request(app).post(`/api/tasks/${crm.id}/recall`).set(auth(tunde)).send({}).expect(404);

    // His own unfinished task: yes, always to himself; whoever gave it to him can still audit it.
    const res = await request(app).post(`/api/tasks/${sso.id}/recall`).set(auth(tunde)).send({ assigneeId: 'demo-maya' }).expect(201);
    expect(res.body.task).toMatchObject({ assigneeId: 'demo-tunde', createdById: sso.createdById, recalledFromId: sso.id });
    expect((await board(tunde)).tasks.map((t) => t.id)).toContain(res.body.task.id);

    // The Recall page lists only what he may recall.
    const recallable = (await request(app).get('/api/history').query({ recallable: 'true' }).set(auth(tunde)).expect(200)).body.rows as Array<{ task: Task }>;
    expect(recallable.map((r) => r.task.id)).not.toContain(sso.id); // already recalled
    expect(recallable.map((r) => r.task.id)).not.toContain(ssl.id); // audited
    expect(recallable.every((r) => r.task.assigneeId === 'demo-tunde' && ['open', 'in_progress', 'blocked'].includes(r.task.status))).toBe(true);
  });

  it('managers recall the work they handed out', async () => {
    const ada = await login('demo-ada');
    const kemi = await login('demo-kemi');
    const crm = await earlier(ada, 'CRM duplicate');
    const res = await request(app).post(`/api/tasks/${crm.id}/recall`).set(auth(kemi)).send({});
    if (crm.createdById === 'demo-kemi') expect(res.status).toBe(201);
    else expect(res.status).toBe(404); // not hers: she can't see it
  });

  it('recalls several at once and explains the ones it skipped', async () => {
    const ada = await login('demo-ada');
    const cve = await earlier(ada, 'CVE');
    const sso = await earlier(ada, 'SSO');
    await request(app).post(`/api/tasks/${sso.id}/recall`).set(auth(ada)).send({}).expect(201);
    const res = await request(app).post('/api/recall').set(auth(ada)).send({ taskIds: [cve.id, sso.id, 'missing-id'] }).expect(200);
    expect(res.body.recalled.map((r: { fromId: string }) => r.fromId)).toEqual([cve.id]);
    expect(res.body.skipped).toHaveLength(2);
    expect(res.body.skipped.find((x: { id: string }) => x.id === sso.id).reason).toMatch(/Already recalled/);
    expect((await board(ada)).earlier.unfinished).toBe(0);
  });

  it('a recalled unfinished task is settled: no more work, alerts or counts on the original', async () => {
    const ada = await login('demo-ada');
    const sso = await earlier(ada, 'SSO'); // blocked
    const copy = (await request(app).post(`/api/tasks/${sso.id}/recall`).set(auth(ada)).send({}).expect(201)).body.task as Task;
    const res = await request(app).post(`/api/tasks/${sso.id}/transitions`).set(auth(ada)).send({ action: 'unblock' }).expect(409);
    expect(res.body.error.message).toContain(`DLG-${copy.seq}`);
    expect((await board(ada)).blocked.map((t) => t.id)).not.toContain(sso.id);
    const blocked = (await request(app).get('/api/history').query({ status: 'blocked' }).set(auth(ada)).expect(200)).body.rows as Array<{ task: Task }>;
    expect(blocked.map((r) => r.task.id)).not.toContain(sso.id);
  });
});

describe('blocked tasks wait on History → Blocked', () => {
  it('lists blocked work from any day (today included), out of the lanes, and it comes back when unblocked', async () => {
    const ada = await login('demo-ada');
    const b = await board(ada);
    const titles = b.blocked.map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['Negotiate courier contract renewal', 'Integrate SSO for enterprise pilot'])); // today's and yesterday's

    const rows = (await request(app).get('/api/history').query({ status: 'blocked' }).set(auth(ada)).expect(200)).body.rows as Array<{ task: Task }>;
    expect(rows.map((r) => r.task.title).sort()).toEqual([...titles].sort());
    expect(rows.every((r) => r.task.status === 'blocked')).toBe(true);
    // "In motion" no longer includes blocked work.
    const active = (await request(app).get('/api/history').query({ status: 'active' }).set(auth(ada)).expect(200)).body.rows as Array<{ task: Task }>;
    expect(active.every((r) => r.task.status === 'in_progress')).toBe(true);

    // Unblocking it puts it back in motion, on its own day.
    const courier = rows.find((r) => r.task.title.startsWith('Negotiate courier'))!.task;
    await request(app).post(`/api/tasks/${courier.id}/transitions`).set(auth(ada)).send({ action: 'unblock' }).expect(200);
    expect((await board(ada)).blocked.map((t) => t.id)).not.toContain(courier.id);
    expect((await board(ada)).tasks.find((t) => t.id === courier.id)?.status).toBe('in_progress');
  });

  it('staff see only their own blocked work, and work blocked on them', async () => {
    const leo = await login('demo-leo'); // the SSO task is waiting on Leo
    const tunde = await login('demo-tunde');
    expect((await board(leo)).blocked.map((t) => t.title)).toEqual(['Integrate SSO for enterprise pilot']);
    expect((await board(tunde)).blocked.map((t) => t.title)).toEqual(['Integrate SSO for enterprise pilot']);
    expect((await board(await login('demo-sara'))).blocked).toEqual([]);
  });
});
