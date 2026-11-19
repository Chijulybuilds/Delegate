import { canSeeTask, hoursBetween, type Member, type MemberRole, type StandupBrief, type Task, type VelocityResponse, type VelocityRow } from '@delegate/shared';
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

export class MetricsService {
  constructor(private store: Store) {}

  /** Everyone but the owner gets numbers for the tasks they can see (their own and those they handed out). */
  private async scoped(orgId: string, viewer?: Viewer) {
    const [all, everyone] = await Promise.all([this.store.listTasks({ orgId }), this.store.listMembers(orgId)]);
    if (!viewer || viewer.role === 'owner') return { tasks: all, members: everyone };
    const tasks = all.filter((t) => canSeeTask(viewer, t));
    const people = new Set([viewer.userId, ...tasks.map((t) => t.assigneeId)]);
    return { tasks, members: everyone.filter((m) => people.has(m.userId)) };
  }

  async velocity(orgId: string, windowDays: number, viewer?: Viewer): Promise<VelocityResponse> {
    const { tasks, members } = await this.scoped(orgId, viewer);
    const since = Date.now() - windowDays * DAY;
    const shipped = tasks.filter((t) => t.submittedAt && new Date(t.submittedAt).getTime() >= since);

    const rowFor = (m: Member): VelocityRow => {
      const mine = shipped.filter((t) => t.assigneeId === m.userId);
      const timed = mine.map((t) => hoursBetween(t.createdAt, t.submittedAt)).filter((h): h is number => h !== null);
      const withDue = mine.filter((t) => t.dueAt);
      return {
        userId: m.userId,
        fullName: m.fullName,
        avatarUrl: m.avatarUrl,
        completed: mine.length,
        approved: mine.filter((t) => t.status === 'approved').length,
        avgHoursToGreen: avg(timed),
        onTimeRate: withDue.length ? withDue.filter((t) => t.submittedAt! <= t.dueAt!).length / withDue.length : null,
        openNow: tasks.filter((t) => t.assigneeId === m.userId && (t.status === 'open' || t.status === 'in_progress')).length,
        blockedNow: tasks.filter((t) => t.assigneeId === m.userId && t.status === 'blocked').length,
      };
    };

    const rows = members
      .map(rowFor)
      // Fastest operators first; people with no shipped work sink to the bottom.
      .sort((a, b) => (a.avgHoursToGreen ?? Infinity) - (b.avgHoursToGreen ?? Infinity) || b.completed - a.completed);

    const allTimed = shipped.map((t) => hoursBetween(t.createdAt, t.submittedAt)).filter((h): h is number => h !== null);
    const withDue = shipped.filter((t) => t.dueAt);

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
        avgHoursToGreen: avg(allTimed),
        onTimeRate: withDue.length ? withDue.filter((t) => t.submittedAt! <= t.dueAt!).length / withDue.length : null,
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
