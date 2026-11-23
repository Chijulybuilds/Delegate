import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { LedgerEvent, Task, VelocityResponse } from '@delegate/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { judgeDelivery } from '../src/services/metrics.js';
import { MemoryStore } from '../src/store/memory.js';
import { seedDemo } from '../src/store/seed.js';

const H = 3_600_000;
const T0 = Date.parse('2026-11-16T09:00:00Z');
const at = (hours: number) => new Date(T0 + hours * H).toISOString();

function task(over: Partial<Task> & { doneAfter: number }): Task {
  const { doneAfter, ...rest } = over;
  return {
    id: 't1', orgId: 'o', seq: 1, source: 'app', title: 'x', description: '', status: 'done', priority: 'medium', size: 'm',
    assigneeId: 'u1', createdById: 'boss', departmentId: null, dueAt: null, blockedReason: null, waitingOnId: null,
    startedAt: at(0), submittedAt: at(doneAfter), approvedAt: null, approvedById: null, blockedAt: null, escalationLevel: 0,
    overdueAlertedAt: null, playbookId: null, createdAt: at(0), updatedAt: at(doneAfter), ...rest,
  };
}
let n = 0;
const ev = (type: LedgerEvent['type'], hours: number, extra: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: String(++n), orgId: 'o', taskId: 't1', actorId: 'u1', type, fromStatus: null, toStatus: null, meta: {}, createdAt: at(hours), ...extra,
});

describe('judging a delivery fairly', () => {
  it('without a deadline, the bar is a fair time for the task’s size', () => {
    expect(judgeDelivery(task({ size: 'xs', doneAfter: 3 }), []).onTime).toBe(true); // a quick call, same morning
    expect(judgeDelivery(task({ size: 'xs', doneAfter: 10 }), []).onTime).toBe(false); // a quick call, end of day
    expect(judgeDelivery(task({ size: 'l', doneAfter: 30 }), []).onTime).toBe(true); // a day of video editing, next day
    expect(judgeDelivery(task({ size: null, doneAfter: 20 }), []).onTime).toBe(true); // no size: counts as Medium
    expect(judgeDelivery(task({ size: 'xs', doneAfter: 1 }), []).effort).toBe(0.25);
    expect(judgeDelivery(task({ size: 'l', doneAfter: 1 }), []).effort).toBe(6);
  });

  it('a deadline is the bar, moved back by time blocked on someone else', () => {
    const due = { size: 'xs' as const, dueAt: at(4) };
    expect(judgeDelivery(task({ ...due, doneAfter: 5 }), []).onTime).toBe(false);
    const blocked = [ev('task.blocked', 1), ev('task.unblocked', 3)];
    const d = judgeDelivery(task({ ...due, doneAfter: 5 }), blocked);
    expect(d.onTime).toBe(true);
    expect(d.turnaround).toBeCloseTo(3); // 5 hours, 2 of them blocked
  });

  it('the clock starts when the task became theirs', () => {
    const handed = ev('task.updated', 20, { meta: { reason: 'reassigned', reassigned: { from: 'u0', to: 'u1' } } });
    const d = judgeDelivery(task({ size: 'xs', doneAfter: 22 }), [handed]);
    expect(d.turnaround).toBeCloseTo(2);
    expect(d.onTime).toBe(true);
  });

  it('approved first time counts; sent back for changes doesn’t', () => {
    expect(judgeDelivery(task({ status: 'approved', doneAfter: 2 }), []).firstTime).toBe(true);
    expect(judgeDelivery(task({ status: 'approved', doneAfter: 2 }), [ev('task.changes_requested', 1)]).firstTime).toBe(false);
    expect(judgeDelivery(task({ status: 'done', doneAfter: 2 }), []).firstTime).toBeNull(); // not audited yet
  });
});

describe('the leaderboard', () => {
  const config = loadConfig({ NODE_ENV: 'test', SUPABASE_URL: '', ADMIN_EMAIL: '', CRON_SECRET: 'x' });
  async function setup(scenario?: (store: MemoryStore, add: (assigneeId: string, size: Task['size'], hours: number, i: number, title?: string) => void) => void) {
    const store = new MemoryStore();
    await seedDemo(store);
    if (scenario) {
      for (const t of [...store.tasks.values()]) store.tasks.delete(t.id);
      const orgId = [...store.orgs.values()][0]!.id;
      const base = Date.now() - 5 * 24 * H;
      scenario(store, (assigneeId, size, hours, i, title = 'x') => {
        const created = new Date(base + i * 4 * H).toISOString();
        const id = `${assigneeId}-${i}`;
        store.tasks.set(id, { ...task({ size, doneAfter: 0 }), id, title, orgId, seq: 1000 + store.tasks.size, assigneeId, status: 'approved', approvedAt: created, approvedById: 'demo-ada', createdAt: created, startedAt: created, submittedAt: new Date(Date.parse(created) + hours * H).toISOString(), updatedAt: created });
      });
    }
    const app = createApp({ config, store });
    const login = async (p: string) => (await request(app).post('/api/auth/demo').send({ personaId: p }).expect(200)).body.token as string;
    const ada = await login('demo-ada');
    const get = async (query: Record<string, string> = {}, token = ada, status = 200) => (await request(app).get('/api/metrics/velocity').query({ days: '14', ...query }).set({ Authorization: `Bearer ${token}` }).expect(status)).body as VelocityResponse;
    return { store, app, login, ada, get };
  }

  it('weighs complexity: a few day-long video edits outrank many quick calls; two easy tasks don’t top the board', async () => {
    const { get } = await setup((_store, add) => {
      for (let i = 0; i < 25; i++) add('demo-maya', 'xs', 1, i); // 25 quick calls, each within the hour
      for (let i = 0; i < 5; i++) add('demo-sara', 'l', 20, i); // 5 video edits, each next morning
      for (let i = 0; i < 2; i++) add('demo-leo', 'xs', 1, i); // two easy tasks
    });
    const v = await get();
    expect(v.rows.map((r) => r.userId).slice(0, 3)).toEqual(['demo-sara', 'demo-maya', 'demo-leo']);
    const [sara, maya, leo] = v.rows;
    expect(sara!.impactScore).toBe(100);
    expect(sara!.workHours).toBe(30); // 5 × Large (6h)
    expect(maya!.workHours).toBe(6.3); // 25 × Quick (15 min)
    expect(leo!.impactScore).toBeLessThan(5);
    expect(sara!.sizeMix).toMatchObject({ l: 5, xs: 0 });
    expect(maya!.sizeMix).toMatchObject({ xs: 25 });
    // Nobody with nothing executed sits above someone with work done.
    expect(v.rows.slice(3).every((r) => r.impactScore === null)).toBe(true);
  });

  it('late or sent-back work counts, a little less', async () => {
    const { get } = await setup((_store, add) => {
      add('demo-maya', 'l', 20, 0); // on time
      add('demo-sara', 'l', 60, 0); // a Large task, 60h without a deadline: late
    });
    const v = await get();
    const maya = v.rows.find((r) => r.userId === 'demo-maya')!;
    const sara = v.rows.find((r) => r.userId === 'demo-sara')!;
    expect(maya.impact).toBe(6);
    expect(sara.impact).toBe(4.5);
    expect(sara.onTimeRate).toBe(0);
  });

  it('a size filter compares people on that kind of work only; unsized tasks are estimated from their words', async () => {
    const { get } = await setup((_store, add) => {
      add('demo-maya', null, 1, 0, 'Call the pastor about Sunday');
      add('demo-maya', null, 1, 1, 'Text the choir the new time');
      add('demo-sara', null, 20, 2, 'Edit the 1-hour conference video');
    });
    const all = await get();
    expect(all.estimated).toBe(3);
    expect(all.rows[0]!.userId).toBe('demo-sara');
    const quick = await get({ size: 'xs' });
    expect(quick.size).toBe('xs');
    expect(quick.rows[0]!.userId).toBe('demo-maya');
    expect(quick.rows.find((r) => r.userId === 'demo-sara')!.completed).toBe(0);
  });

  it('a picked day shows just that day’s numbers, for any day the plan keeps', async () => {
    const { get } = await setup();
    const v = await get({ days: '7' });
    expect(v.firstDay < v.daily[0]!.date).toBe(true); // the plan keeps 30 days; the chart shows 7
    expect(v.activeDays.length).toBeGreaterThan(5);
    const busy = v.activeDays[0]!; // older than the chart's window
    const day = await get({ days: '7', day: busy });
    expect(day.day).toBe(busy);
    expect(day.team.completed).toBeGreaterThan(0);
    expect(day.rows.filter((r) => r.impactScore !== null).length).toBe(day.rows.filter((r) => r.completed > 0).length);
    expect(day.team.completed).toBeLessThan(v.team.completed + 5);
    await get({ day: '2001-01-01' }, undefined, 400);
  });

  it('only the owner sees Insights', async () => {
    const { get, login, app } = await setup();
    const kemi = await login('demo-kemi'); // a manager
    const tunde = await login('demo-tunde');
    await get({}, kemi, 403);
    await get({}, tunde, 403);
    await request(app).get('/api/standup').set({ Authorization: `Bearer ${tunde}` }).expect(403);
    await request(app).post('/api/metrics/size-tasks').set({ Authorization: `Bearer ${kemi}` }).expect(403);
  });

  it('sizes the tasks nobody sized (word rules without AI), and they stay sized', async () => {
    const { store, app, ada } = await setup();
    const t = [...store.tasks.values()][0]!;
    store.tasks.set(t.id, { ...t, size: null, title: 'Call the venue manager' });
    const res = (await request(app).post('/api/metrics/size-tasks').set({ Authorization: `Bearer ${ada}` }).expect(200)).body;
    expect(res).toMatchObject({ method: 'rules', remaining: 0 });
    expect(res.sized).toBeGreaterThanOrEqual(1);
    expect(store.tasks.get(t.id)!.size).toBe('xs');
  });
});
