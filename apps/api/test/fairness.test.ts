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
  it('ranks by the fair score, shows work done by size, and eases small samples toward the team', async () => {
    const store = new MemoryStore();
    await seedDemo(store);
    const app = createApp({ config: loadConfig({ NODE_ENV: 'test', SUPABASE_URL: '', ADMIN_EMAIL: '', CRON_SECRET: 'x' }), store });
    const token = (await request(app).post('/api/auth/demo').send({ personaId: 'demo-ada' }).expect(200)).body.token as string;
    const v = (await request(app).get('/api/metrics/velocity?days=30').set({ Authorization: `Bearer ${token}` }).expect(200)).body as VelocityResponse;

    const scored = v.rows.filter((r) => r.fairScore !== null);
    expect(scored.length).toBeGreaterThan(2);
    for (let i = 1; i < scored.length; i++) expect(scored[i - 1]!.fairScore!).toBeGreaterThanOrEqual(scored[i]!.fairScore!);
    // Nobody with work done sits below someone with none.
    const firstEmpty = v.rows.findIndex((r) => r.fairScore === null);
    if (firstEmpty >= 0) expect(v.rows.slice(firstEmpty).every((r) => r.fairScore === null)).toBe(true);
    // Work done adds up the sizes, not the count.
    expect(v.team.workHours).toBeGreaterThan(v.team.completed * 0.25);
    for (const r of scored) {
      expect(r.fairScore!).toBeGreaterThanOrEqual(0);
      expect(r.fairScore!).toBeLessThanOrEqual(100);
    }
  });

  it('two people judged by their own work: many quick tasks vs. a few big ones, both on time, score alike', async () => {
    const store = new MemoryStore();
    await seedDemo(store);
    // Wipe history so only this scenario counts.
    for (const t of [...store.tasks.values()]) store.tasks.delete(t.id);
    const base = Date.now() - 5 * 24 * H;
    const add = (assigneeId: string, size: Task['size'], hours: number, i: number) => {
      const created = new Date(base + i * 6 * H).toISOString();
      const id = `${assigneeId}-${i}`;
      store.tasks.set(id, { ...task({ size, doneAfter: 0 }), id, orgId: [...store.orgs.values()][0]!.id, seq: 1000 + store.tasks.size, assigneeId, status: 'approved', approvedAt: created, approvedById: 'demo-ada', createdAt: created, startedAt: created, submittedAt: new Date(Date.parse(created) + hours * H).toISOString(), updatedAt: created });
    };
    for (let i = 0; i < 12; i++) add('demo-maya', 'xs', 1, i); // calls and texts, each within the hour
    for (let i = 0; i < 3; i++) add('demo-sara', 'l', 20, i); // video edits, each next morning
    const app = createApp({ config: loadConfig({ NODE_ENV: 'test', SUPABASE_URL: '', ADMIN_EMAIL: '', CRON_SECRET: 'x' }), store });
    const token = (await request(app).post('/api/auth/demo').send({ personaId: 'demo-ada' }).expect(200)).body.token as string;
    const v = (await request(app).get('/api/metrics/velocity?days=14').set({ Authorization: `Bearer ${token}` }).expect(200)).body as VelocityResponse;
    const maya = v.rows.find((r) => r.userId === 'demo-maya')!;
    const sara = v.rows.find((r) => r.userId === 'demo-sara')!;
    expect(maya.fairScore).toBe(100);
    expect(sara.fairScore).toBe(100); // 20h vs 1h, but a Large task the next morning is on time
    expect(maya.avgHoursToGreen).toBeLessThan(sara.avgHoursToGreen!);
    expect(sara.workHours).toBe(18); // 3 × Large (6h)
    expect(maya.workHours).toBe(3); // 12 × Quick (15 min)
  });
});
