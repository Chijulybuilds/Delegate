import {
  isManagerRole,
  playbookRunsOn,
  PLAYBOOK_CADENCES,
  taskRef,
  TASK_PRIORITIES,
  type Organization,
  type Playbook,
  type PlaybookItem,
  type Task,
} from '@delegate/shared';
import { z } from 'zod';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
import type { Store } from '../store/types.js';
import type { BillingService } from './billing.js';
import { WHATSAPP_TEMPLATES } from './channels.js';
import type { Mailer } from './mail.js';
import { standupToText, type MetricsService } from './metrics.js';
import type { Notifier } from './notify.js';
import type { Ctx, WorkspaceService } from './workspace.js';

const HOUR = 3_600_000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wall-clock parts of `now` in an IANA time zone. */
export function localParts(now: Date, timeZone: string) {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
  } catch {
    return localParts(now, 'UTC');
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: DAY_NAMES.indexOf(parts.weekday ?? 'Mon'),
    hhmm: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
  };
}

export const playbookInput = z.object({
  name: z.string().trim().min(2).max(80),
  active: z.boolean().default(true),
  cadence: z.enum(PLAYBOOK_CADENCES),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  monthDay: z.number().int().min(1).max(28).nullable().default(null),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)'),
  items: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        title: z.string().trim().min(3).max(160),
        description: z.string().max(2000).default(''),
        assigneeId: z.string().min(1),
        priority: z.enum(TASK_PRIORITIES).default('medium'),
        dueInHours: z.number().min(0.5).max(24 * 31).default(8),
      }),
    )
    .min(1, 'Add at least one task')
    .max(30),
});

export interface TickReport {
  workspaces: number;
  playbookRuns: number;
  tasksCreated: number;
  escalations: number;
  overdue: number;
  digests: number;
}

export class AutomationService {
  constructor(
    private store: Store,
    private workspace: WorkspaceService,
    private notifier: Notifier,
    private billing: BillingService,
    private metrics: MetricsService,
    private mailer: Mailer,
  ) {}

  /* ------------------------------------------------------------------ the tick */

  /** Idempotent: safe to call every few minutes from Vercel Cron, Supabase pg_cron or crontab. */
  async tick(now = new Date(), onlyOrgId?: string): Promise<TickReport> {
    const report: TickReport = { workspaces: 0, playbookRuns: 0, tasksCreated: 0, escalations: 0, overdue: 0, digests: 0 };
    const orgs = (await this.store.listOrgs()).filter((o) => o.status === 'active' && (!onlyOrgId || o.id === onlyOrgId));
    for (const org of orgs) {
      report.workspaces++;
      try {
        await this.runDuePlaybooks(org, now, report);
        await this.escalate(org, now, report);
        await this.digest(org, now, report);
      } catch (error) {
        console.error(`[automation] workspace ${org.id} failed`, error);
      }
    }
    return report;
  }

  private async runDuePlaybooks(org: Organization, now: Date, report: TickReport) {
    const local = localParts(now, org.timezone);
    for (const pb of await this.store.listPlaybooks(org.id)) {
      if (!pb.active || pb.lastRunOn === local.date) continue;
      if (!playbookRunsOn(pb, local.date, local.weekday) || local.hhmm < pb.timeOfDay) continue;
      const created = await this.runPlaybook(pb, `${pb.id}:${local.date}`, now);
      await this.store.savePlaybook({ ...pb, lastRunOn: local.date });
      report.playbookRuns++;
      report.tasksCreated += created.length;
    }
  }

  /** Creates the playbook's tasks. `runKey` makes each run create each task at most once. */
  async runPlaybook(pb: Playbook, runKey: string, now = new Date()): Promise<Task[]> {
    const members = await this.store.listMembers(pb.orgId);
    const runner = members.find((m) => m.userId === pb.createdById && isManagerRole(m.role)) ?? members.find((m) => m.role === 'owner');
    if (!runner) return [];
    const ctx: Ctx = { userId: runner.userId, orgId: pb.orgId, role: runner.role };
    const created: Task[] = [];
    for (const item of pb.items) {
      if (!members.some((m) => m.userId === item.assigneeId)) continue; // assignee left the workspace
      try {
        created.push(
          await this.workspace.createTask(
            ctx,
            { title: item.title, description: item.description, assigneeId: item.assigneeId, priority: item.priority, dueAt: new Date(now.getTime() + item.dueInHours * HOUR).toISOString() },
            'playbook',
            { playbookId: pb.id, occurrenceKey: `${runKey}:${item.id}` },
          ),
        );
      } catch (error) {
        if (error instanceof HttpError && error.code === 'duplicate_occurrence') continue;
        throw error;
      }
    }
    if (created.length) {
      await this.store.appendEvent({ orgId: pb.orgId, taskId: null, actorId: null, type: 'playbook.ran', fromStatus: null, toStatus: null, meta: { playbookId: pb.id, name: pb.name, tasks: created.length } });
    }
    return created;
  }

  private async escalate(org: Organization, now: Date, report: TickReport) {
    const { escalation } = org.settings;
    const ent = await this.billing.entitlements(org.id);
    if (!escalation.enabled || !ent.features.escalations) return;
    const tasks = await this.store.listTasks({ orgId: org.id, statuses: ['open', 'in_progress', 'blocked'] });
    for (const task of tasks) {
      if (task.status === 'blocked' && task.blockedAt) {
        const hours = (now.getTime() - new Date(task.blockedAt).getTime()) / HOUR;
        const level = hours >= escalation.blockedOwnerHours ? 2 : hours >= escalation.blockedManagerHours ? 1 : 0;
        if (level > task.escalationLevel) {
          const updated = await this.store.updateTask(task.id, { escalationLevel: level });
          await this.store.appendEvent({ orgId: org.id, taskId: task.id, actorId: null, type: 'task.escalated', fromStatus: null, toStatus: null, meta: { title: task.title, ref: taskRef(task.seq), level, hours: Math.round(hours), reason: 'blocked' } });
          await this.notifier.dispatch({ type: 'escalated', org, task: updated, level: level as 1 | 2, reason: 'blocked', hours });
          report.escalations++;
        }
      }
      if (task.dueAt && !task.overdueAlertedAt) {
        const late = (now.getTime() - new Date(task.dueAt).getTime()) / HOUR;
        if (late >= escalation.overdueHours) {
          const updated = await this.store.updateTask(task.id, { overdueAlertedAt: now.toISOString() });
          await this.notifier.dispatch({ type: 'overdue', org, task: updated, hours: late });
          report.overdue++;
        }
      }
    }
  }

  private async digest(org: Organization, now: Date, report: TickReport) {
    const { digest, lastDigestOn } = org.settings;
    const local = localParts(now, org.timezone);
    if (!digest.enabled || lastDigestOn === local.date || local.hour < digest.hour) return;
    // Claim today's digest first so concurrent ticks don't double-send.
    await this.store.updateOrg(org.id, { settings: { ...org.settings, lastDigestOn: local.date } });

    const brief = await this.metrics.standup(org.id, now);
    const text = standupToText(brief);
    const ent = await this.billing.entitlements(org.id);
    const appUrl = this.notifier.appUrl();

    await this.notifier.postToChannels(org, 'digest', {
      title: `Standup · ${brief.date}`,
      body: `${brief.completedYesterday.length} shipped yesterday · ${brief.newToday.length} new today · ${brief.blockers.length} blocked · ${brief.awaitingAudit.length} awaiting audit`,
      url: `${appUrl}/app/insights?tab=standup`,
      facts: brief.blockers.slice(0, 5).map((b) => [taskRef(b.task.seq), `${b.assignee}: ${b.task.blockedReason ?? ''}`]),
    });

    const members = await this.store.listMembers(org.id);
    if (ent.features.whatsapp && (await this.store.getIntegrationFor(org.id, 'whatsapp'))) {
      const open = await this.store.listTasks({ orgId: org.id, statuses: ['open', 'in_progress', 'blocked'] });
      for (const m of members) {
        const profile = await this.store.getProfile(m.userId);
        const mine = open.filter((t) => t.assigneeId === m.userId);
        if (!profile?.phone || !mine.length) continue;
        const list = mine.slice(0, 6).map((t) => `${taskRef(t.seq)} ${t.title}`).join(' · ');
        await this.notifier.whatsappTemplate(org.id, profile.phone, WHATSAPP_TEMPLATES.digest, [m.fullName.split(' ')[0]!, String(mine.length), list], `Morning digest (${mine.length})`);
      }
    }

    if (ent.features.standupEmail && this.mailer.enabled) {
      // The whole team's brief: only owners see everyone's work.
      const to = members.filter((m) => m.role === 'owner').map((m) => m.email).filter(Boolean);
      const ok = await this.mailer.send({ to, subject: `${org.name} · Standup for ${brief.date}`, text });
      await this.store.logOutbound({ orgId: org.id, channel: 'email', target: `${to.length} owner(s)`, summary: `Standup ${brief.date}`, status: ok ? 'sent' : 'failed', error: ok ? null : 'Email provider rejected the message' });
    }
    report.digests++;
  }

  /* ------------------------------------------------------------------ playbook CRUD */

  async listPlaybooks(ctx: Ctx) {
    return this.store.listPlaybooks(ctx.orgId);
  }

  async savePlaybook(ctx: Ctx, raw: unknown, id?: string): Promise<Playbook> {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can manage playbooks');
    const input = playbookInput.parse(raw);
    const members = await this.store.listMembers(ctx.orgId);
    for (const item of input.items) {
      if (!members.some((m) => m.userId === item.assigneeId)) throw badRequest(`"${item.title}" is assigned to someone outside this workspace`);
    }
    if (input.cadence === 'weekly' && input.weekday === null) throw badRequest('Pick a weekday for a weekly playbook');
    if (input.cadence === 'monthly' && input.monthDay === null) throw badRequest('Pick a day of the month (1–28)');

    let existing: Playbook | null = null;
    if (id) {
      existing = await this.store.getPlaybook(id);
      if (!existing || existing.orgId !== ctx.orgId) throw notFound('Playbook not found');
    } else {
      const ent = await this.billing.entitlements(ctx.orgId);
      const count = (await this.store.listPlaybooks(ctx.orgId)).length;
      if (ent.maxPlaybooks !== null && count >= ent.maxPlaybooks) {
        throw new HttpError(402, `The Starter plan includes ${ent.maxPlaybooks} playbook. Upgrade to Team for unlimited playbooks.`, 'upgrade_required');
      }
    }
    const items: PlaybookItem[] = input.items.map((i) => ({ ...i, id: i.id ?? uuid() }));
    return this.store.savePlaybook({
      id: existing?.id,
      orgId: ctx.orgId,
      name: input.name,
      active: input.active,
      cadence: input.cadence,
      weekday: input.cadence === 'weekly' ? input.weekday : null,
      monthDay: input.cadence === 'monthly' ? input.monthDay : null,
      timeOfDay: input.timeOfDay,
      items,
      createdById: existing?.createdById ?? ctx.userId,
      lastRunOn: existing?.lastRunOn ?? null,
    });
  }

  async deletePlaybook(ctx: Ctx, id: string) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can manage playbooks');
    const pb = await this.store.getPlaybook(id);
    if (!pb || pb.orgId !== ctx.orgId) throw notFound('Playbook not found');
    await this.store.deletePlaybook(id);
  }

  async runNow(ctx: Ctx, id: string) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can run playbooks');
    const pb = await this.store.getPlaybook(id);
    if (!pb || pb.orgId !== ctx.orgId) throw notFound('Playbook not found');
    return this.runPlaybook(pb, `${pb.id}:manual:${Date.now()}`);
  }
}
