import { canSeeTask, isSettledByRecall, SIZE_META, sizeOf, type LedgerEvent, type Member, type MemberRole, type StandupBrief, type Task, type VelocityResponse, type VelocityRow } from '@delegate/shared';
import type { Store } from '../store/types.js';

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
/** How many tasks' worth of "team average" a person's score starts from, so 1–2 lucky tasks don't top the board. */
const PRIOR_TASKS = 3;
const ON_TIME_WEIGHT = 0.7;

/** One executed task, judged fairly: against its own deadline or size, from when it became theirs, minus time blocked on others. */
interface Delivery {
  task: Task;
  /** Hours from being given the task to executing it, not counting time blocked. */
  turnaround: number;
  onTime: boolean;
  /** null = not audited yet; true = approved without changes requested. */
  firstTime: boolean | null;
  effort: number;
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
  return { task, turnaround, onTime, firstTime: audited ? !sentBack : null, effort: size.effortHours };
}

/** 0–100 from a set of deliveries (null with none). */
function rawScore(ds: Delivery[]): number | null {
  if (!ds.length) return null;
  const onTime = ds.filter((d) => d.onTime).length / ds.length;
  const audited = ds.filter((d) => d.firstTime !== null);
  const firstTime = audited.length ? audited.filter((d) => d.firstTime).length / audited.length : null;
  return 100 * (firstTime === null ? onTime : ON_TIME_WEIGHT * onTime + (1 - ON_TIME_WEIGHT) * firstTime);
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
   * The leaderboard, made fair: every task is judged against its own deadline, or a fair time for
   * its size (a quick call vs. a day of editing), from when it became the person's, not counting
   * time blocked on others; approval without changes counts too. How much work someone gets depends
   * on what they're given, so it's shown ("work done") but doesn't change the ranking.
   */
  async velocity(orgId: string, windowDays: number, viewer?: Viewer): Promise<VelocityResponse> {
    const { tasks, members } = await this.scoped(orgId, viewer);
    const since = Date.now() - windowDays * DAY;
    const shipped = tasks.filter((t) => t.submittedAt && new Date(t.submittedAt).getTime() >= since);

    const ids = new Set(shipped.map((t) => t.id));
    const earliest = shipped.reduce((min, t) => (t.createdAt < min ? t.createdAt : min), new Date(since).toISOString());
    const byTask = new Map<string, LedgerEvent[]>();
    if (shipped.length) {
      for (const e of await this.eventsSince(orgId, earliest)) {
        if (!e.taskId || !ids.has(e.taskId)) continue;
        byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);
      }
    }
    const deliveries = shipped.map((t) => judgeDelivery(t, byTask.get(t.id) ?? []));
    const teamScore = rawScore(deliveries);
    const rate = (ds: Delivery[], pick: (d: Delivery) => boolean | null) => {
      const judged = ds.filter((d) => pick(d) !== null);
      return judged.length ? judged.filter((d) => pick(d)).length / judged.length : null;
    };
    const sum = (ds: Delivery[]) => Math.round(ds.reduce((a, d) => a + d.effort, 0) * 10) / 10;

    const rowFor = (m: Member): VelocityRow => {
      const mine = deliveries.filter((d) => d.task.assigneeId === m.userId);
      const raw = rawScore(mine);
      return {
        userId: m.userId,
        fullName: m.fullName,
        avatarUrl: m.avatarUrl,
        completed: mine.length,
        approved: mine.filter((d) => d.task.status === 'approved').length,
        avgHoursToGreen: avg(mine.map((d) => d.turnaround)),
        onTimeRate: rate(mine, (d) => d.onTime),
        firstTimeRate: rate(mine, (d) => d.firstTime),
        workHours: sum(mine),
        // Eased toward the team's score until there are a few tasks to go on.
        fairScore: raw === null || teamScore === null ? null : Math.round((mine.length * raw + PRIOR_TASKS * teamScore) / (mine.length + PRIOR_TASKS)),
        openNow: tasks.filter((t) => t.assigneeId === m.userId && (t.status === 'open' || t.status === 'in_progress')).length,
        blockedNow: tasks.filter((t) => t.assigneeId === m.userId && t.status === 'blocked').length,
      };
    };

    const rows = members
      .map(rowFor)
      // Fairest first; people with nothing executed yet sink to the bottom.
      .sort((a, b) => (b.fairScore ?? -1) - (a.fairScore ?? -1) || b.workHours - a.workHours);

    const daily: VelocityResponse['daily'] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = windowDays - 1; i >= 0; i--) {
      const start = today.getTime() - i * DAY;
      daily.push({
        date: new Date(start).toISOString().slice(0, 10),
        completed: shipped.filter((t) => {
          const ts = new Date(t.submittedAt!).getTime();
          return ts >= start && ts < start + DAY;
        }).length,
      });
    }

    return {
      windowDays,
      team: {
        completed: shipped.length,
        avgHoursToGreen: avg(deliveries.map((d) => d.turnaround)),
        onTimeRate: rate(deliveries, (d) => d.onTime),
        firstTimeRate: rate(deliveries, (d) => d.firstTime),
        workHours: sum(deliveries),
        openNow: tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
        blockedNow: tasks.filter((t) => t.status === 'blocked').length,
        awaitingAudit: tasks.filter((t) => t.status === 'done').length,
      },
      rows,
      daily,
    };
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
