import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppNotification, BoardResponse, LedgerEvent, Task } from '@delegate/shared';
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
const find = (title: string) => [...store.tasks.values()].find((t) => t.title.includes(title))!;
const notifications = async (token: string) => (await request(app).get('/api/notifications').set(auth(token)).expect(200)).body as { notifications: AppNotification[]; tasks: Record<string, { count: number }> };

describe('reassign: an unfinished task changes hands', () => {
  it('the owner moves a task in motion today to someone else: it starts over for them, and both are told', async () => {
    const ada = await login('demo-ada');
    const onboarding = find('onboarding email sequence'); // Tunde's, in motion today
    expect(onboarding.status).toBe('in_progress');

    const res = await request(app).post(`/api/tasks/${onboarding.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-leo', note: 'Leo, Tunde is on the SSO pilot now.' }).expect(200);
    expect(res.body.task).toMatchObject({ id: onboarding.id, assigneeId: 'demo-leo', status: 'open', startedAt: null, createdAt: onboarding.createdAt });

    // It stays on today's board (same task, same day), now with Leo, who sees it and hears about it.
    const leo = await login('demo-leo');
    expect((await board(leo)).tasks.map((t) => t.id)).toContain(onboarding.id);
    expect((await notifications(leo)).tasks[onboarding.id]?.count).toBe(2); // reassigned + the note
    const detail = (await request(app).get(`/api/tasks/${onboarding.id}`).set(auth(leo)).expect(200)).body;
    expect(detail.comments.at(-1).body).toBe('Leo, Tunde is on the SSO pilot now.');

    // Tunde no longer sees it, but he's told it's off his list.
    const tunde = await login('demo-tunde');
    expect((await board(tunde)).tasks.map((t) => t.id)).not.toContain(onboarding.id);
    expect((await notifications(tunde)).notifications.find((n) => n.type === 'reassigned_away')).toMatchObject({ taskId: null, title: expect.stringContaining('moved to Leo') });

    // The history says who moved it from whom to whom.
    const events = (await request(app).get('/api/feed').set(auth(ada)).expect(200)).body.events as LedgerEvent[];
    expect(events.find((e) => e.type === 'task.updated' && e.taskId === onboarding.id)).toMatchObject({
      fromStatus: 'in_progress',
      toStatus: 'open',
      meta: { reason: 'reassigned', reassigned: { from: 'demo-tunde', to: 'demo-leo' }, name: 'Tunde Bakare', toName: 'Leo Martins' },
    });
  });

  it('works on earlier days too (History), and a blocker waiting on the new person is cleared', async () => {
    const ada = await login('demo-ada');
    const sso = find('SSO'); // Tunde's, from yesterday, blocked waiting on Leo
    const cve = find('CVE'); // Tunde's, from two days ago, never started
    const moved = (await request(app).post(`/api/tasks/${sso.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-leo' }).expect(200)).body.task as Task;
    expect(moved).toMatchObject({ assigneeId: 'demo-leo', status: 'open', waitingOnId: null, blockedReason: null, createdAt: sso.createdAt });
    // Not waiting on the new person: the blocker stays with the task.
    const courier = find('courier contract'); // Maya's, blocked waiting on Kemi
    expect((await request(app).post(`/api/tasks/${courier.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-tunde' }).expect(200)).body.task).toMatchObject({ status: 'blocked', waitingOnId: 'demo-kemi' });
    // An open one just changes hands.
    expect((await request(app).post(`/api/tasks/${cve.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-sara' }).expect(200)).body.task).toMatchObject({ assigneeId: 'demo-sara', status: 'open' });
  });

  it('finished, audited and recalled tasks don’t change hands, and the rules on who may hold', async () => {
    const ada = await login('demo-ada');
    const done = find('QA release 3.4'); // executed, awaiting audit
    const audited = find('SSL certificates');
    const open = find('job post for ops');
    await request(app).post(`/api/tasks/${done.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-maya' }).expect(409);
    await request(app).post(`/api/tasks/${audited.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-maya' }).expect(409);
    await request(app).post(`/api/tasks/${open.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-maya' }).expect(400); // already hers
    await request(app).post(`/api/tasks/${open.id}/reassign`).set(auth(ada)).send({ assigneeId: 'not-a-member' }).expect(400);

    const cve = find('CVE');
    const copy = (await request(app).post(`/api/tasks/${cve.id}/recall`).set(auth(ada)).send({}).expect(201)).body.task as Task;
    const res = await request(app).post(`/api/tasks/${cve.id}/reassign`).set(auth(ada)).send({ assigneeId: 'demo-leo' }).expect(409);
    expect(res.body.error.message).toContain(`DLG-${copy.seq}`);

    // Staff can't reassign, not even their own work.
    const tunde = await login('demo-tunde');
    await request(app).post(`/api/tasks/${copy.id}/reassign`).set(auth(tunde)).send({ assigneeId: 'demo-leo' }).expect(403);
  });

  it('managers reassign only the work they handed out', async () => {
    const kemi = await login('demo-kemi');
    const theirs = (await request(app).post('/api/tasks').set(auth(kemi)).send({ title: 'Cut the teaser to 15 seconds', assigneeId: 'demo-tunde' }).expect(201)).body.task as Task;
    const mine = find('Q4 board deck'); // Kemi's own task, handed to her by Ada
    await request(app).post(`/api/tasks/${mine.id}/reassign`).set(auth(kemi)).send({ assigneeId: 'demo-sara' }).expect(403);
    await request(app).post(`/api/tasks/${theirs.id}/reassign`).set(auth(kemi)).send({ assigneeId: 'demo-sara' }).expect(200);
  });

  it('changing the assignee in the task panel goes through the same rules', async () => {
    const ada = await login('demo-ada');
    const onboarding = find('onboarding email sequence');
    const res = await request(app).patch(`/api/tasks/${onboarding.id}`).set(auth(ada)).send({ assigneeId: 'demo-maya', priority: 'urgent' }).expect(200);
    expect(res.body.task).toMatchObject({ assigneeId: 'demo-maya', status: 'open', priority: 'urgent' });
    const done = find('QA release 3.4');
    await request(app).patch(`/api/tasks/${done.id}`).set(auth(ada)).send({ assigneeId: 'demo-maya' }).expect(409);
  });
});
