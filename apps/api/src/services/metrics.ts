import { canSeeTask, isSettledByRecall, SIZE_META, sizeOf, TASK_SIZES, type LedgerEvent, type TaskSize, type Member, type MemberRole, type StandupBrief, type Task, type VelocityResponse, type VelocityRow } from '@delegate/shared';
import type { Store } from '../store/types.js';
import { badRequest } from '../lib/errors.js';
import type { TaskSizer } from './ai.js';

const DAY = 86_400_000;

/** UTC instant of local midnight for `date` in IANA time zone `tz`. */
export function startOfDayInTz(date: Date, tz: string): Date {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(date)
        .map((p) => [p.type, p.value]),
    );
  } catch {
    return startOfDayInTz(date, 'UTC');
  }
  const guess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - date.getTime();
}

type Viewer = { userId: string; role: MemberRole };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const HOUR = 3_600_000;
/** Late work still counts, a little less; so does work the audit sent back. */
const LATE_CREDIT = 0.75;
const SENT_BACK_CREDIT = 0.85;

/** One executed task, judged fairly: against its own deadline or size, from when it became theirs, minus time blocked on others. */
interface Delivery {
  task: Task;
  /** Hours from being given the task to executing it, not counting time blocked. */
  turnaround: number;
  onTime: boolean;
  /** null = not audited yet; true = approved without changes requested. */
  firstTime: boolean | null;
  size: TaskSize;
  /** Typical hours of work for its size. */
  effort: number;
  /** The effort it earns: full when on time and right first time, less when late or sent back. */
  credit: number;
}

/** Hours of [a, b] that fall inside [lo, hi]. */
const overlap = (a: number, b: number, lo: number, hi: number) => Math.max(0, Math.min(b, hi) - Math.max(a, lo));

export function judgeDelivery(task: Task, events: LedgerEvent[]): Delivery {
  const evs = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // The clock starts when the task became this person's: given to them, or reassigned/handed over to them.
  let start = Date.parse(task.createdAt);
  for (const e of evs) {
    const to = (e.meta.reassigned as { to?: string } | undefined)?.to;
    if (e.type === 'task.updated' && to === task.assigneeId) start = Math.max(start, Date.parse(e.createdAt));
  }
  const end = Date.parse(task.submittedAt ?? task.updatedAt);
  // Time spent blocked (waiting on a teammate, a customer…) doesn't count against them.
  let blockedMs = 0;
  let since: number | null = null;
  for (const e of evs) {
    const at = Date.parse(e.createdAt);
    if (e.type === 'task.blocked') since ??= at;
    else if (since !== null && (e.type === 'task.unblocked' || (e.fromStatus === 'blocked' && e.toStatus && e.toStatus !== 'blocked'))) {
      blockedMs += overlap(since, at, start, end);
      since = null;
    }
  }
  if (since !== null) blockedMs += overlap(since, end, start, end);
  const turnaround = Math.max(0, end - start - blockedMs) / HOUR;
  const due = task.dueAt ? Date.parse(task.dueAt) : null;
  const size = SIZE_META[sizeOf(task)];
  // A deadline set for them is the bar (moved back by any time blocked); without one, a fair time for its size.
  const onTime = due !== null && due > start ? end <= due + blockedMs : turnaround <= size.fairHours;
  const sentBack = evs.some((e) => e.type === 'task.changes_requested');
  const audited = task.status === 'approved' || sentBack;
  const firstTime = audited ? !sentBack : null;
  const credit = size.effortHours * (onTime ? 1 : LATE_CREDIT) * (firstTime === false ? SENT_BACK_CREDIT : 1);
  return { task, turnaround, onTime, firstTime, size: sizeOf(task), effort: size.effortHours, credit };
}

export class MetricsService {
  constructor(private store: Store) {}

  /** Everyone but the owner gets numbers for the tasks they can see (their own and those they handed out). */
  private async scoped(orgId: string, viewer?: Viewer) {
    const [everything, everyone] = await Promise.all([this.store.listTasks({ orgId }), this.store.listMembers(orgId)]);
    // Recalled originals carry on as their copies: count each piece of work once.
    const all = everything.filter((t) => !isSettledByRecall(t));
    if (!viewer || viewer.role === 'owner') return { tasks: all, members: everyone };
    const tasks = all.filter((t) => canSeeTask(viewer, t));
    const people = new Set([viewer.userId, ...tasks.map((t) => t.assigneeId)]);
    return { tasks, members: everyone.filter((m) => people.has(m.userId)) };
  }

  /** Ledger events back to `sinceIso`, newest first, a page at a time. */
  private async eventsSince(orgId: string, sinceIso: string): Promise<LedgerEvent[]> {
    const out: LedgerEvent[] = [];
    let before: string | undefined;
    for (let page = 0; page < 25; page++) {
      const batch = await this.store.listEvents({ orgId, before, limit: 1000 });
      for (const e of batch) {
        if (e.createdAt < sinceIso) return out;
        out.push(e);
      }
      if (batch.length < 1000) break;
      before = batch[batch.length - 1]!.createdAt;
    }
    return out;
  }

  /**
   * Insights for the owner. The leaderboard ranks by impact: the work each person delivered,
   * weighted by complexity (a day of video editing counts for far more than a quick call), with
   * a little less credit for work that was late (against its deadline, or a fair time for its size)
   * or sent back at the audit. The clock starts when a task became theirs and pauses while it's
   * blocked on someone else. Pick a day (any day the plan keeps) to see just that day's numbers;
   * pick a size to compare people on that kind of work only.
   */
  async velocity(orgId: string, windowDays: number, viewer?: Viewer, opts: { day?: string; size?: TaskSize; maxDays?: number } = {}): Promise<VelocityResponse> {
    const org = await this.store.getOrg(orgId);
    const timezone = org?.timezone || 'UTC';
    const { tasks, members } = await this.scoped(orgId, viewer);

    // Every day the plan keeps, in the workspace's time zone; the chart shows the last `windowDays`.
    const maxDays = Math.max(windowDays, opts.maxDays ?? windowDays);
    const keyOf = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayStart = startOfDayInTz(new Date(), timezone);
    const starts = [todayStart];
    for (let i = 1; i < maxDays; i++) starts.unshift(startOfDayInTz(new Date(starts[0]!.getTime() - 12 * HOUR), timezone));
    const tomorrow = startOfDayInTz(new Date(todayStart.getTime() + 36 * HOUR), timezone);
    const allDays = starts.map((st, i) => ({ date: keyOf.format(new Date(st.getTime() + HOUR)), start: st.getTime(), end: (starts[i + 1] ?? tomorrow).getTime() }));
    const buckets = allDays.slice(-windowDays);
    const picked = opts.day ? allDays.find((b) => b.date === opts.day) : null;
    if (opts.day && !picked) throw badRequest(`Pick a day within the last ${maxDays} days`);
    const range = picked ?? { start: buckets[0]!.start, end: tomorrow.getTime() };

    const ofSize = (t: Task) => !opts.size || sizeOf(t) === opts.size;
    const executedIn = (lo: number, hi: number) =>
      tasks.filter((t) => {
        const at = t.submittedAt ? Date.parse(t.submittedAt) : NaN;
        return at >= lo && at < hi && ofSize(t);
      });
    const inPlan = executedIn(allDays[0]!.start, tomorrow.getTime());
    const shipped = executedIn(range.start, range.end);

    // The ledger behind the fair clock.
    const ids = new Set(shipped.map((t) => t.id));
    const earliest = Math.min(range.start, ...shipped.map((t) => Date.parse(t.createdAt)));
    const byTask = new Map<string, LedgerEvent[]>();
    const events = shipped.length ? await this.eventsSince(orgId, new Date(earliest).toISOString()) : [];
    for (const e of events) {
      if (!e.taskId || !ids.has(e.taskId)) continue;
      byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);
    }
    const deliveries = shipped.map((t) => judgeDelivery(t, byTask.get(t.id) ?? []));
    const rate = (ds: Delivery[], pick: (d: Delivery) => boolean | null) => {
      const judged = ds.filter((d) => pick(d) !== null);
      return judged.length ? judged.filter((d) => pick(d)).length / judged.length : null;
    };
    const round1 = (x: number) => Math.round(x * 10) / 10;
    const total = (ds: Delivery[], f: (d: Delivery) => number) => round1(ds.reduce((a, d) => a + f(d), 0));

    const rowFor = (m: Member): VelocityRow => {
      const mine = deliveries.filter((d) => d.task.assigneeId === m.userId);
      const sizeMix = Object.fromEntries(TASK_SIZES.map((z) => [z, mine.filter((d) => d.size === z).length])) as Record<TaskSize, number>;
      return {
        userId: m.userId,
        fullName: m.fullName,
        avatarUrl: m.avatarUrl,
        completed: mine.length,
        approved: mine.filter((d) => d.task.status === 'approved').length,
        avgHoursToGreen: avg(mine.map((d) => d.turnaround)),
        onTimeRate: rate(mine, (d) => d.onTime),
        firstTimeRate: rate(mine, (d) => d.firstTime),
        workHours: total(mine, (d) => d.effort),
        impact: total(mine, (d) => d.credit),
        impactScore: null,
        sizeMix,
        openNow: tasks.filter((t) => t.assigneeId === m.userId && (t.status === 'open' || t.status === 'in_progress')).length,
        blockedNow: tasks.filter((t) => t.assigneeId === m.userId && t.status === 'blocked').length,
      };
    };
    const rows = members.map(rowFor);
    const top = Math.max(0, ...rows.map((r) => r.impact));
    for (const r of rows) r.impactScore = r.completed && top > 0 ? Math.round((100 * r.impact) / top) : null;
    // Most impact first; people with nothing executed sink to the bottom.
    rows.sort((a, b) => b.impact - a.impact || (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1) || b.completed - a.completed);

    const dayOf = (t: Task) => allDays.find((b) => Date.parse(t.submittedAt!) >= b.start && Date.parse(t.submittedAt!) < b.end)?.date;
    const daily = buckets.map((b) => {
      const done = inPlan.filter((t) => {
        const at = Date.parse(t.submittedAt!);
        return at >= b.start && at < b.end;
      });
      return { date: b.date, completed: done.length, workHours: round1(done.reduce((a, t) => a + SIZE_META[sizeOf(t)].effortHours, 0)) };
    });

    return {
      windowDays,
      day: picked?.date ?? null,
      size: opts.size ?? null,
      timezone,
      estimated: shipped.filter((t) => !t.size).length,
      firstDay: allDays[0]!.date,
      activeDays: [...new Set(inPlan.map(dayOf).filter((d): d is string => !!d))].sort(),
      team: {
        completed: shipped.length,
        avgHoursToGreen: avg(deliveries.map((d) => d.turnaround)),
        onTimeRate: rate(deliveries, (d) => d.onTime),
        firstTimeRate: rate(deliveries, (d) => d.firstTime),
        workHours: total(deliveries, (d) => d.effort),
        impact: total(deliveries, (d) => d.credit),
        openNow: tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
        blockedNow: tasks.filter((t) => t.status === 'blocked').length,
        awaitingAudit: tasks.filter((t) => t.status === 'done').length,
      },
      rows,
      daily,
    };
  }

  /** Gives every unsized task a size (AI when it's set up, else the word rules), so it's visible and editable. */
  async sizeUnsized(orgId: string, sizer: TaskSizer, limit = 300): Promise<{ sized: number; remaining: number; method: TaskSizer['method'] }> {
    const unsized = (await this.store.listTasks({ orgId })).filter((t) => !t.size && !isSettledByRecall(t));
    const batch = unsized.slice(0, limit);
    const sizes = await sizer.estimate(batch.map((t) => ({ id: t.id, title: t.title, description: t.description })));
    let sized = 0;
    for (const t of batch) {
      const size = sizes.get(t.id);
      if (!size) continue;
      await this.store.updateTask(t.id, { size });
      sized++;
    }
    return { sized, remaining: unsized.length - sized, method: sizer.method };
  }

  async standup(orgId: string, now = new Date(), viewer?: Viewer): Promise<StandupBrief> {
    const org = await this.store.getOrg(orgId);
    const { tasks } = await this.scoped(orgId, viewer);
    const members = await this.store.listMembers(orgId);
    const tz = org?.timezone || 'UTC';
    const todayStart = startOfDayInTz(now, tz).getTime();
    const yesterdayStart = startOfDayInTz(new Date(todayStart - DAY / 2), tz).getTime();
    const name = (id: string | null) => (id ? (members.find((m) => m.userId === id)?.fullName ?? 'Former member') : null);
    const withName = (t: Task) => ({ task: t, assignee: name(t.assigneeId) ?? 'Unassigned' });
    const inYesterday = (iso: string | null) => {
      if (!iso) return false;
      const ts = new Date(iso).getTime();
      return ts >= yesterdayStart && ts < todayStart;
    };

    return {
      orgName: org?.name ?? 'Workspace',
      date: new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now),
      generatedAt: now.toISOString(),
      completedYesterday: tasks
        .filter((t) => (t.status === 'done' || t.status === 'approved') && (inYesterday(t.submittedAt) || inYesterday(t.approvedAt)))
        .map(withName),
      newToday: tasks.filter((t) => new Date(t.createdAt).getTime() >= todayStart).map(withName),
      blockers: tasks.filter((t) => t.status === 'blocked').map((t) => ({ ...withName(t), waitingOn: name(t.waitingOnId) })),
      overdue: tasks
        .filter((t) => ['open', 'in_progress', 'blocked'].includes(t.status) && t.dueAt && new Date(t.dueAt).getTime() < now.getTime())
        .map(withName),
      awaitingAudit: tasks.filter((t) => t.status === 'done').map(withName),
    };
  }
}

export function standupToText(b: StandupBrief): string {
  const section = (title: string, items: string[]) =>
    `${title}\n${items.length ? items.map((i) => `  • ${i}`).join('\n') : '  — none'}`;
  return [
    `${b.orgName} — Standup for ${b.date}`,
    '',
    section(`Shipped yesterday (${b.completedYesterday.length})`, b.completedYesterday.map((x) => `${x.task.title} — ${x.assignee}`)),
    '',
    section(`New today (${b.newToday.length})`, b.newToday.map((x) => `${x.task.title} — ${x.assignee}`)),
    '',
    section(
      `Blockers (${b.blockers.length})`,
      b.blockers.map((x) => `${x.task.title} — ${x.assignee}${x.waitingOn ? `, waiting on ${x.waitingOn}` : ''}: ${x.task.blockedReason ?? ''}`),
    ),
    '',
    section(`Overdue (${b.overdue.length})`, b.overdue.map((x) => `${x.task.title} — ${x.assignee}`)),
    '',
    section(`Awaiting your audit (${b.awaitingAudit.length})`, b.awaitingAudit.map((x) => `${x.task.title} — ${x.assignee}`)),
  ].join('\n');
}
