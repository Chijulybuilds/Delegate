import {
  availableActions,
  canRecall,
  canSeeTask,
  DEFAULT_ORG_SETTINGS,
  LANES,
  isManagerRole,
  taskRef,
  TRANSITIONS,
  type AuditFilters,
  type AuditRow,
  type AuditsResponse,
  type BoardResponse,
  type HistoryResponse,
  type TaskFilters,
  type EventType,
  type LedgerEvent,
  type MemberRole,
  type Organization,
  type Profile,
  type ProofSource,
  type Task,
  type TaskDetail,
  type TaskPriority,
  type TaskProof,
  type TaskSource,
  type TaskStatus,
  type TransitionAction,
} from '@delegate/shared';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { inviteCode, slugify, uuid } from '../lib/ids.js';
import type { Store } from '../store/types.js';
import type { ProofVerifier } from './ai.js';
import { trialSubscription, type BillingService } from './billing.js';
import type { DriveService } from './drive.js';
import { startOfDayInTz } from './metrics.js';
import type { DomainEvent, Notifier } from './notify.js';

export interface Ctx {
  userId: string;
  orgId: string;
  role: MemberRole;
}

export interface ProofInput {
  kind: 'link' | 'note' | 'file';
  url?: string | null;
  note?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  /** Signed Google Drive verification (see DriveService.verify). */
  attestation?: string | null;
}

export interface TransitionInput {
  reason?: string;
  waitingOnId?: string | null;
  comment?: string;
  proofs?: ProofInput[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigneeId?: string;
  departmentId?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
}

/** A proof that came from a system of record, not typed by a person. */
export interface SystemProof {
  kind: 'link' | 'note';
  url: string | null;
  note: string | null;
  source: ProofSource;
  verified: boolean;
}

const DEFAULT_DEPARTMENTS: Array<[string, string]> = [
  ['Operations', '#6E56CF'],
  ['Engineering', '#0EA5A4'],
  ['Creative', '#D9480F'],
];


export interface WorkspaceDeps {
  store: Store;
  verifier: ProofVerifier;
  notifier: Notifier;
  billing: BillingService;
  drive: DriveService;
}

export class WorkspaceService {
  private store: Store;
  private verifier: ProofVerifier;
  private notifier: Notifier;
  private billing: BillingService;
  private drive: DriveService;

  constructor(deps: WorkspaceDeps) {
    this.store = deps.store;
    this.verifier = deps.verifier;
    this.notifier = deps.notifier;
    this.billing = deps.billing;
    this.drive = deps.drive;
  }

  /* ------------------------------ Onboarding ------------------------------ */

  async createWorkspace(user: Profile, input: { name: string; timezone?: string }): Promise<Organization> {
    if (await this.store.getMembershipForUser(user.id)) throw conflict('You already belong to a workspace');
    const base = slugify(input.name);
    let slug = base;
    for (let i = 2; await this.store.slugExists(slug); i++) slug = `${base}-${i}`;

    const org = await this.store.createOrg({
      name: input.name.trim(),
      slug,
      inviteCode: inviteCode(input.name),
      timezone: input.timezone || 'UTC',
      settings: structuredClone(DEFAULT_ORG_SETTINGS),
    });
    const depts = await Promise.all(DEFAULT_DEPARTMENTS.map(([name, color]) => this.store.createDepartment({ orgId: org.id, name, color })));
    await this.store.addMember({ orgId: org.id, userId: user.id, role: 'owner', departmentId: depts[0]?.id ?? null });
    await this.store.upsertSubscription(trialSubscription(org.id));
    await this.log(org.id, user.id, 'org.created', null, { name: org.name });
    return org;
  }

  async joinWorkspace(user: Profile, code: string): Promise<Organization> {
    if (await this.store.getMembershipForUser(user.id)) throw conflict('You already belong to a workspace');
    const org = await this.store.getOrgByInviteCode(code.trim());
    if (!org) throw notFound('That invite code does not match any workspace');
    if (org.status === 'suspended') throw forbidden('This workspace is suspended');
    const ent = await this.billing.entitlements(org.id);
    const count = (await this.store.listMemberships(org.id)).length;
    if (ent.maxMembers !== null && count >= ent.maxMembers) {
      throw new HttpError(402, `${org.name} is on the free Starter plan (up to ${ent.maxMembers} people). Ask the owner to upgrade so you can join.`, 'upgrade_required');
    }
    await this.store.addMember({ orgId: org.id, userId: user.id, role: 'member', departmentId: null });
    await this.log(org.id, user.id, 'member.joined', null, { name: user.fullName });
    await this.billing.syncSeats(org.id);
    return org;
  }

  /* ------------------------------- Members -------------------------------- */

  async updateMember(ctx: Ctx, userId: string, patch: { role?: MemberRole; departmentId?: string | null }) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can change team settings');
    const members = await this.store.listMembers(ctx.orgId);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw notFound('Member not found');
    if (patch.role !== undefined) {
      if (ctx.role !== 'owner') throw forbidden('Only the workspace owner can change roles');
      if (target.role === 'owner') throw forbidden('The owner role cannot be changed');
      if (patch.role === 'owner') throw badRequest('Ownership transfer is not supported yet');
    }
    if (patch.departmentId) await this.assertDepartment(ctx.orgId, patch.departmentId);
    await this.store.updateMember(ctx.orgId, userId, patch);
    if (patch.role && patch.role !== target.role) {
      await this.log(ctx.orgId, ctx.userId, 'member.role_changed', null, { userId, name: target.fullName, from: target.role, to: patch.role });
    }
  }

  async createDepartment(ctx: Ctx, input: { name: string; color?: string }) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can add departments');
    const existing = await this.store.listDepartments(ctx.orgId);
    if (existing.some((d) => d.name.toLowerCase() === input.name.trim().toLowerCase())) throw conflict('A department with that name already exists');
    return this.store.createDepartment({ orgId: ctx.orgId, name: input.name.trim(), color: input.color || '#6B7280' });
  }

  async updateOrg(ctx: Ctx, patch: { name?: string; timezone?: string; regenerateInvite?: boolean; settings?: Partial<Organization['settings']> }) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can change workspace settings');
    if (patch.name !== undefined && ctx.role !== 'owner') throw forbidden('Only the owner can rename the workspace');
    if (patch.regenerateInvite && ctx.role !== 'owner') throw forbidden('Only the workspace owner can manage the invite code');
    const org = await this.store.getOrg(ctx.orgId);
    if (!org) throw notFound('Workspace not found');
    if (patch.settings?.escalation?.enabled) await this.billing.require(ctx.orgId, 'escalations', 'Escalation alerts');
    return this.store.updateOrg(ctx.orgId, {
      ...(patch.name ? { name: patch.name.trim() } : {}),
      ...(patch.timezone ? { timezone: patch.timezone } : {}),
      ...(patch.regenerateInvite ? { inviteCode: inviteCode(org.name) } : {}),
      ...(patch.settings
        ? {
            settings: {
              ...org.settings,
              ...patch.settings,
              escalation: { ...org.settings.escalation, ...(patch.settings.escalation ?? {}) },
              digest: { ...org.settings.digest, ...(patch.settings.digest ?? {}) },
            },
          }
        : {}),
    });
  }

  /* -------------------------------- Tasks --------------------------------- */

  /**
   * Today's board. Every day starts empty: it shows only tasks given out today (in the workspace's
   * time zone). Earlier days live on the History page; `earlier` counts what's still unfinished there.
   */
  async listBoard(ctx: Ctx): Promise<BoardResponse> {
    const org = await this.store.getOrg(ctx.orgId);
    const timezone = org?.timezone || 'UTC';
    const dayStart = startOfDayInTz(new Date(), timezone).toISOString();
    const mine = (await this.store.listTasks({ orgId: ctx.orgId })).filter((t) => canSeeTask(ctx, t));
    const tasks = mine.filter((t) => t.createdAt >= dayStart);
    const before = mine.filter((t) => t.createdAt < dayStart);
    const visible = new Set(tasks.map((t) => t.id));
    // Latest AI verdict + verified source per task, so cards can badge without N+1 calls.
    const proofs = (await this.store.listProofsForOrg(ctx.orgId)).filter((p) => visible.has(p.taskId));
    const aiVerdicts: Record<string, TaskProof['aiVerdict']> = {};
    const verified: Record<string, ProofSource> = {};
    for (const p of proofs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (p.aiVerdict) aiVerdicts[p.taskId] = p.aiVerdict;
      if (p.verified) verified[p.taskId] = p.source;
    }
    return {
      tasks,
      aiVerdicts,
      verified,
      day: { start: dayStart, timezone },
      // Earlier days live on History; everyone sees their own (the owner sees all of them).
      earlier: {
        unfinished: before.filter((t) => !t.recalledToId && (t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked')).length,
        awaitingAudit: isManagerRole(ctx.role) ? before.filter((t) => !t.recalledToId && t.status === 'done').length : 0,
      },
    };
  }

  /** Loads a task for a person (visibility rules apply) or, with only `orgId`, for the system. */
  async getTaskForCtx(ctx: Pick<Ctx, 'orgId'> & Partial<Pick<Ctx, 'userId' | 'role'>>, id: string): Promise<Task> {
    const task = await this.store.getTask(id);
    // Same 404 for "missing", "other tenant" and "not yours to see", so IDs can't be probed.
    if (!task || task.orgId !== ctx.orgId) throw notFound('Task not found');
    if (ctx.userId && ctx.role && !canSeeTask({ userId: ctx.userId, role: ctx.role }, task)) throw notFound('Task not found');
    return task;
  }

  /** The activity feed: everything for the owner; for everyone else, only events on tasks they can see. */
  async feed(ctx: Ctx, q: { limit: number; before?: string }): Promise<LedgerEvent[]> {
    if (ctx.role === 'owner') return this.store.listEvents({ orgId: ctx.orgId, limit: q.limit, before: q.before });
    const visible = new Set((await this.store.listTasks({ orgId: ctx.orgId })).filter((t) => canSeeTask(ctx, t)).map((t) => t.id));
    const out: LedgerEvent[] = [];
    let before = q.before;
    for (let page = 0; page < 6 && out.length < q.limit; page++) {
      const batch = await this.store.listEvents({ orgId: ctx.orgId, limit: 100, before });
      out.push(...batch.filter((e) => (e.taskId ? visible.has(e.taskId) : e.actorId === ctx.userId)));
      if (batch.length < 100) break;
      before = batch[batch.length - 1]!.createdAt;
    }
    return out.slice(0, q.limit);
  }

  /** Names and departments for a list of tasks (people who left are looked up once). */
  private async describeTasks(orgId: string, tasks: Task[]): Promise<AuditRow[]> {
    const [members, departments] = await Promise.all([this.store.listMembers(orgId), this.store.listDepartments(orgId)]);
    const names = new Map(members.map((m) => [m.userId, m.fullName]));
    for (const id of new Set(tasks.flatMap((t) => [t.assigneeId, t.createdById, t.approvedById]).filter((x): x is string => !!x && !names.has(x)))) {
      names.set(id, (await this.store.getProfile(id))?.fullName ?? 'Former member');
    }
    const dept = new Map(departments.map((d) => [d.id, d.name]));
    return tasks.map((t) => ({
      task: t,
      assigneeName: names.get(t.assigneeId) ?? 'Former member',
      creatorName: names.get(t.createdById) ?? 'Former member',
      auditorName: t.approvedById ? (names.get(t.approvedById) ?? 'Former member') : null,
      departmentName: t.departmentId ? (dept.get(t.departmentId) ?? null) : null,
      hoursToGreen: t.submittedAt ? Math.max(0, (Date.parse(t.submittedAt) - Date.parse(t.createdAt)) / 3_600_000) : null,
    }));
  }

  /** Search box + person + priority + status + date range (+ time of day), shared by Waiting on me and Audits. */
  private filterRows(rows: AuditRow[], f: TaskFilters, dateOf: (t: Task) => string, timezone = 'UTC') {
    const q = f.q?.trim().toLowerCase().replace(/^#/, '');
    const from = f.from ? Date.parse(f.from) : null;
    const to = f.to ? Date.parse(f.to) : null;
    const statuses = f.status === 'unfinished' ? ['open', 'in_progress', 'blocked'] : f.status ? (LANES.find((l) => l.id === f.status)?.statuses as readonly string[] | undefined) : undefined;
    const minutes = (hhmm?: string) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);
    const fromMin = minutes(f.fromTime);
    const toMin = minutes(f.toTime);
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return rows
      .filter(({ task: t, assigneeName, creatorName, auditorName }) => {
        if (f.assigneeId && t.assigneeId !== f.assigneeId) return false;
        if (f.priority && t.priority !== f.priority) return false;
        if (statuses && !statuses.includes(t.status)) return false;
        const at = Date.parse(dateOf(t));
        if (from !== null && at < from) return false;
        if (to !== null && at >= to) return false;
        if (fromMin !== null || toMin !== null) {
          const local = minutes(clock.format(at)) ?? 0;
          if (fromMin !== null && local < fromMin) return false;
          if (toMin !== null && local >= toMin) return false;
        }
        if (q) {
          const hay = `${taskRef(t.seq)} ${t.seq} ${t.title} ${t.description} ${assigneeName} ${creatorName} ${auditorName ?? ''}`.toLowerCase();
          if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
        }
        return true;
      })
      .sort((a, b) => dateOf(b.task).localeCompare(dateOf(a.task)));
  }

  /** The all-time audit record (owner only): every audited task, newest audit first, filtered. */
  async audits(ctx: Ctx, f: AuditFilters, page = 1, pageSize = 50): Promise<AuditsResponse> {
    if (ctx.role !== 'owner') throw forbidden('Only the workspace owner can see the audit record');
    const tasks = await this.store.listTasks({ orgId: ctx.orgId, statuses: ['approved'] });
    const rows = this.filterRows(await this.describeTasks(ctx.orgId, tasks), f, (t) => t.approvedAt ?? t.updatedAt);
    const start = (page - 1) * pageSize;
    return { rows: rows.slice(start, start + pageSize), total: rows.length, page, pageSize };
  }

  /** History: every earlier task the viewer can see (all of them for the owner; their own for everyone else), newest first. */
  async history(ctx: Ctx, f: TaskFilters, page = 1, pageSize = 60): Promise<HistoryResponse> {
    const org = await this.store.getOrg(ctx.orgId);
    const timezone = org?.timezone || 'UTC';
    const dayStart = startOfDayInTz(new Date(), timezone).toISOString();
    const tasks = (await this.store.listTasks({ orgId: ctx.orgId })).filter((t) => t.createdAt < dayStart && canSeeTask(ctx, t) && (!f.recallable || canRecall(ctx, t, dayStart)));
    const rows = this.filterRows(await this.describeTasks(ctx.orgId, tasks), f, (t) => t.createdAt, timezone);
    const start = (page - 1) * pageSize;
    return { rows: rows.slice(start, start + pageSize), total: rows.length, page, pageSize, timezone };
  }

  async findByRef(orgId: string, ref: string | number): Promise<Task | null> {
    const seq = typeof ref === 'number' ? ref : Number(String(ref).replace(/^DLG-/i, '').replace(/^#/, ''));
    if (!Number.isInteger(seq) || seq <= 0) return null;
    return this.store.getTaskBySeq(orgId, seq);
  }

  async detail(ctx: Pick<Ctx, 'orgId'> & Partial<Pick<Ctx, 'userId' | 'role'>>, id: string): Promise<TaskDetail> {
    const task = await this.getTaskForCtx(ctx, id);
    const [proofs, comments, events] = await Promise.all([this.store.listProofs(id), this.store.listComments(id), this.store.listEvents({ taskId: id, limit: 100 })]);
    return { task, proofs, comments, events };
  }

  async createTask(
    ctx: Ctx,
    input: CreateTaskInput,
    source: TaskSource = 'app',
    extra: { playbookId?: string; occurrenceKey?: string; createdById?: string; recalledFromId?: string } = {},
  ): Promise<Task> {
    const members = await this.store.listMembers(ctx.orgId);
    const assigneeId = input.assigneeId ?? ctx.userId;
    const assignee = members.find((m) => m.userId === assigneeId);
    if (!assignee) throw badRequest('Assignee must be a member of this workspace');
    if (!isManagerRole(ctx.role) && assigneeId !== ctx.userId) throw forbidden('Only managers can assign tasks to teammates');
    const departmentId = input.departmentId === undefined ? assignee.departmentId : input.departmentId;
    if (departmentId) await this.assertDepartment(ctx.orgId, departmentId);

    const task = await this.store.insertTask({
      orgId: ctx.orgId,
      source,
      title: input.title.trim().slice(0, 160),
      description: (input.description ?? '').trim().slice(0, 4000),
      status: 'open',
      priority: input.priority ?? 'medium',
      assigneeId,
      createdById: extra.createdById ?? ctx.userId,
      departmentId: departmentId ?? null,
      dueAt: input.dueAt ?? endOfToday(),
      blockedReason: null,
      waitingOnId: null,
      startedAt: null,
      submittedAt: null,
      approvedAt: null,
      approvedById: null,
      blockedAt: null,
      escalationLevel: 0,
      overdueAlertedAt: null,
      playbookId: extra.playbookId ?? null,
      occurrenceKey: extra.occurrenceKey ?? null,
      ...(extra.recalledFromId ? { recalledFromId: extra.recalledFromId } : {}),
    });
    await this.log(ctx.orgId, ctx.userId, 'task.created', task, { assigneeId, source, ...(extra.recalledFromId ? { recalledFrom: extra.recalledFromId } : {}) }, null, 'open');
    await this.emit({ type: 'assigned', task, actorId: ctx.userId });
    return task;
  }

  /**
   * Recall: an earlier task comes back onto today's board as a new task, linked both ways. The
   * original keeps its history (an audited task stays audited) and stops counting as left over.
   */
  async recall(ctx: Ctx, id: string, opts: { assigneeId?: string; dueAt?: string | null; note?: string } = {}): Promise<{ task: Task; from: Task }> {
    const org = await this.store.getOrg(ctx.orgId);
    const tz = org?.timezone || 'UTC';
    const dayStart = startOfDayInTz(new Date(), tz);
    const from = await this.getTaskForCtx(ctx, id);
    if (from.recalledToId) {
      const to = await this.store.getTask(from.recalledToId);
      throw conflict(`Already recalled${to ? ` as ${taskRef(to.seq)}` : ''}. Recall that one instead if it needs another day.`);
    }
    if (from.createdAt >= dayStart.toISOString()) throw badRequest('This task is already on today’s board.');
    if (!canRecall(ctx, from, dayStart.toISOString())) {
      throw forbidden(ctx.role === 'member' ? 'You can recall your own tasks that weren’t finished.' : 'You can’t recall this task.');
    }
    // Managers can hand it to someone else; staff bring their own work back.
    const assigneeId = isManagerRole(ctx.role) ? (opts.assigneeId ?? from.assigneeId) : ctx.userId;
    // A manager recalling it hands it out; staff keep the person who gave it to them (who can audit it).
    const createdById = isManagerRole(ctx.role) ? ctx.userId : from.createdById;
    const dueAt = opts.dueAt !== undefined ? opts.dueAt : this.dueTodayLike(from, dayStart, tz);
    const task = await this.createTask(
      ctx,
      { title: from.title, description: from.description, priority: from.priority, assigneeId, departmentId: from.departmentId, dueAt: dueAt ?? undefined },
      'app',
      { createdById, recalledFromId: from.id },
    );
    await this.store.updateTask(from.id, { recalledToId: task.id });
    await this.log(ctx.orgId, ctx.userId, 'task.recalled', from, { toTaskId: task.id, toRef: taskRef(task.seq), fromRef: taskRef(from.seq) });
    if (opts.note?.trim()) await this.comment(ctx, task.id, opts.note.trim());
    return { task: (await this.store.getTask(task.id)) ?? task, from: { ...from, recalledToId: task.id } };
  }

  /** Recall several at once (the Recall page). Each is checked on its own; failures are reported, not fatal. */
  async recallMany(ctx: Ctx, ids: string[]) {
    const recalled: Array<{ fromId: string; task: Task }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of [...new Set(ids)]) {
      try {
        const r = await this.recall(ctx, id);
        recalled.push({ fromId: id, task: r.task });
      } catch (error) {
        skipped.push({ id, reason: error instanceof HttpError ? error.message : 'Could not recall this task' });
      }
    }
    return { recalled, skipped };
  }

  /** The original's due time of day (workspace time), today, if that's still ahead; otherwise null (the usual end of day). */
  private dueTodayLike(from: Task, dayStart: Date, tz: string): string | null {
    if (!from.dueAt) return null;
    const due = new Date(from.dueAt);
    const sinceMidnight = due.getTime() - startOfDayInTz(due, tz).getTime();
    const candidate = new Date(dayStart.getTime() + sinceMidnight);
    return candidate.getTime() > Date.now() + 15 * 60_000 ? candidate.toISOString() : null;
  }

  async updateTask(ctx: Ctx, id: string, patch: Partial<CreateTaskInput>): Promise<Task> {
    const task = await this.getTaskForCtx(ctx, id);
    if (!isManagerRole(ctx.role) && task.createdById !== ctx.userId) throw forbidden('Only managers or the task creator can edit this task');
    if (task.status === 'approved') throw conflict('Audited tasks are locked');
    const next: Partial<Task> = {};
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.description !== undefined) next.description = patch.description.trim();
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.dueAt !== undefined) {
      next.dueAt = patch.dueAt;
      next.overdueAlertedAt = null;
    }
    if (patch.departmentId !== undefined) {
      if (patch.departmentId) await this.assertDepartment(ctx.orgId, patch.departmentId);
      next.departmentId = patch.departmentId;
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId) {
      if (!isManagerRole(ctx.role)) throw forbidden('Only managers can reassign tasks');
      const members = await this.store.listMembers(ctx.orgId);
      if (!members.some((m) => m.userId === patch.assigneeId)) throw badRequest('Assignee must be a member of this workspace');
      next.assigneeId = patch.assigneeId;
    }
    const changed = Object.keys(next).filter((k) => k !== 'overdueAlertedAt' && next[k as keyof Task] !== task[k as keyof Task]);
    if (changed.length === 0) return task;
    const updated = await this.store.updateTask(id, next);
    await this.log(ctx.orgId, ctx.userId, 'task.updated', updated, { fields: changed });
    if (next.assigneeId) await this.emit({ type: 'assigned', task: updated, actorId: ctx.userId });
    return updated;
  }

  /** A person moving a task through the lifecycle (permissions enforced). */
  async transition(ctx: Ctx, id: string, action: TransitionAction, input: TransitionInput): Promise<TaskDetail> {
    const task = await this.getTaskForCtx(ctx, id);
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(task.status)) {
      throw new HttpError(409, `Cannot ${rule.label.toLowerCase()} a task that is ${task.status.replace('_', ' ')}`, 'invalid_transition');
    }
    if (!availableActions(task, { userId: ctx.userId, role: ctx.role }).includes(action)) {
      if (action === 'approve' && task.assigneeId === ctx.userId) throw forbidden('You cannot audit your own work — ask another manager');
      throw forbidden(rule.actors.includes('assignee') && !rule.actors.includes('manager') ? 'Only the assignee can do that' : 'Only managers can do that');
    }
    const proofs = action === 'submit' ? await this.normalizeProofs(task, input.proofs ?? []) : [];
    await this.applyTransition(task, action, input, { actorId: ctx.userId, authorId: ctx.userId, proofs, source: undefined });
    return this.detail(ctx, task.id);
  }

  /**
   * Automations (GitHub, WhatsApp proof, playbooks) move tasks without a signed-in person.
   * State rules still apply; the ledger records actor = null and the source system.
   */
  async systemTransition(orgId: string, taskId: string, action: TransitionAction, input: TransitionInput & { proofs?: never }, opts: { source: string; proofs?: SystemProof[] }) {
    const task = await this.getTaskForCtx({ orgId }, taskId);
    if (!TRANSITIONS[action].from.includes(task.status)) return task;
    return this.applyTransition(task, action, input, {
      actorId: null,
      authorId: task.assigneeId,
      proofs: (opts.proofs ?? []).map((p) => ({ ...p, filePath: null, fileName: null })),
      source: opts.source,
    });
  }

  /** Adds proof without changing state (e.g. a commit that mentions DLG-12). */
  async attachSystemProof(orgId: string, taskId: string, proof: SystemProof, source: string) {
    const task = await this.getTaskForCtx({ orgId }, taskId);
    await this.store.insertProof({ taskId, orgId, authorId: task.assigneeId, ...proof, fileName: null, filePath: null, aiVerdict: null, aiReason: null });
    await this.log(orgId, null, 'task.proof_attached', task, { source, url: proof.url });
  }

  private async applyTransition(
    task: Task,
    action: TransitionAction,
    input: TransitionInput,
    opts: { actorId: string | null; authorId: string; proofs: Array<SystemProof & { filePath: string | null; fileName: string | null }>; source: string | undefined },
  ): Promise<Task> {
    const rule = TRANSITIONS[action];
    const now = new Date().toISOString();
    // Any movement resets the escalation ladder.
    const patch: Partial<Task> = { status: rule.to, escalationLevel: 0 };
    const meta: Record<string, unknown> = opts.source ? { source: opts.source } : {};
    let eventType: EventType;
    let domain: DomainEvent['type'] | null = null;
    let aiVerdict: TaskProof['aiVerdict'] = null;

    switch (action) {
      case 'start':
        patch.startedAt = task.startedAt ?? now;
        eventType = 'task.started';
        break;

      case 'block': {
        const reason = input.reason?.trim();
        if (!reason || reason.length < 3) throw badRequest('Say what is blocking you');
        if (input.waitingOnId) {
          if (input.waitingOnId === task.assigneeId) throw badRequest('A task cannot wait on its own assignee');
          const members = await this.store.listMembers(task.orgId);
          if (!members.some((m) => m.userId === input.waitingOnId)) throw badRequest('That teammate is not in this workspace');
        }
        patch.blockedReason = reason;
        patch.waitingOnId = input.waitingOnId ?? null;
        patch.startedAt = task.startedAt ?? now;
        patch.blockedAt = now;
        Object.assign(meta, { reason, waitingOnId: input.waitingOnId ?? null });
        eventType = 'task.blocked';
        domain = 'blocked';
        break;
      }

      case 'unblock':
        patch.blockedReason = null;
        patch.waitingOnId = null;
        patch.blockedAt = null;
        eventType = 'task.unblocked';
        break;

      case 'submit': {
        if (opts.proofs.length === 0) throw badRequest('Attach at least one proof of work (link, note or file)');
        const ent = await this.billing.entitlements(task.orgId);
        const ai =
          this.verifier.enabled && ent.features.aiVerification
            ? await this.verifier.check({ title: task.title, description: task.description, proofs: opts.proofs.map((p) => ({ ...p })) })
            : null;
        aiVerdict = ai?.verdict ?? null;
        for (const p of opts.proofs) {
          await this.store.insertProof({
            taskId: task.id,
            orgId: task.orgId,
            authorId: opts.authorId,
            kind: p.kind === 'note' ? 'note' : p.filePath ? 'file' : p.kind,
            url: p.url,
            note: p.note,
            fileName: p.fileName,
            filePath: p.filePath,
            source: p.source,
            verified: p.verified,
            aiVerdict: ai?.verdict ?? null,
            aiReason: ai?.reason ?? null,
          });
        }
        patch.submittedAt = now;
        patch.startedAt = task.startedAt ?? now;
        patch.blockedReason = null;
        patch.waitingOnId = null;
        patch.blockedAt = null;
        Object.assign(meta, { proofCount: opts.proofs.length, aiVerdict, verified: opts.proofs.some((p) => p.verified) });
        eventType = 'task.submitted';
        domain = 'submitted';
        break;
      }

      case 'approve':
        if (!opts.actorId) throw forbidden('Audits need a person');
        patch.approvedAt = now;
        patch.approvedById = opts.actorId;
        eventType = 'task.approved';
        domain = 'approved';
        break;

      case 'request_changes': {
        const comment = input.comment?.trim();
        if (!comment) throw badRequest('Tell the assignee what needs to change');
        if (!opts.actorId) throw forbidden('Reviews need a person');
        await this.store.insertComment({ taskId: task.id, orgId: task.orgId, authorId: opts.actorId, body: comment });
        patch.submittedAt = null;
        Object.assign(meta, { comment });
        eventType = 'task.changes_requested';
        domain = 'changes_requested';
        break;
      }
    }

    const updated = await this.store.updateTask(task.id, patch);
    await this.log(task.orgId, opts.actorId, eventType, updated, meta, task.status, rule.to);
    if (domain === 'blocked') await this.emit({ type: 'blocked', task: updated, actorId: opts.actorId });
    if (domain === 'submitted') await this.emit({ type: 'submitted', task: updated, actorId: opts.actorId, aiVerdict, source: opts.source });
    if (domain === 'approved') await this.emit({ type: 'approved', task: updated, actorId: opts.actorId! });
    if (domain === 'changes_requested') await this.emit({ type: 'changes_requested', task: updated, actorId: opts.actorId!, comment: String(meta.comment) });
    return updated;
  }

  async comment(ctx: Ctx, id: string, body: string) {
    const task = await this.getTaskForCtx(ctx, id);
    // Everyone already in the conversation hears about the new message (on the task itself).
    const participants = [...new Set((await this.store.listComments(task.id)).map((c) => c.authorId))];
    const comment = await this.store.insertComment({ taskId: task.id, orgId: ctx.orgId, authorId: ctx.userId, body: body.trim() });
    const preview = body.trim().slice(0, 140);
    await this.log(ctx.orgId, ctx.userId, 'task.commented', task, { preview });
    await this.emit({ type: 'commented', task, actorId: ctx.userId, preview, participants });
    return comment;
  }

  /**
   * Prepares a proof upload. With Supabase the browser uploads straight to Storage (no size
   * limits from serverless request bodies); in demo mode the file goes through the API.
   */
  async prepareProofUpload(ctx: Ctx, id: string, fileName: string, size: number) {
    const task = await this.getTaskForCtx(ctx, id);
    if (task.assigneeId !== ctx.userId) throw forbidden('Only the assignee can attach proof');
    if (task.status !== 'in_progress') throw conflict('Start the task before attaching proof');
    if (size > 25 * 1024 * 1024) throw badRequest('Files can be up to 25 MB');
    const filePath = this.proofPath(ctx.orgId, task.id, fileName);
    const signed = await this.store.createUploadUrl(filePath);
    return signed ? { mode: 'direct' as const, filePath, fileName: fileName.slice(0, 200), ...signed } : { mode: 'api' as const };
  }

  async uploadProofFile(ctx: Ctx, id: string, file: { originalname: string; mimetype: string; buffer: Buffer }) {
    const task = await this.getTaskForCtx(ctx, id);
    if (task.assigneeId !== ctx.userId) throw forbidden('Only the assignee can attach proof');
    if (task.status !== 'in_progress') throw conflict('Start the task before attaching proof');
    const filePath = this.proofPath(ctx.orgId, task.id, file.originalname);
    await this.store.putFile(filePath, file.buffer, file.mimetype || 'application/octet-stream');
    return { filePath, fileName: file.originalname.slice(0, 200) };
  }

  async proofFile(ctx: Ctx, taskId: string, proofId: string) {
    await this.getTaskForCtx(ctx, taskId);
    const proof = (await this.store.listProofs(taskId)).find((p) => p.id === proofId);
    if (!proof?.filePath) throw notFound('File not found');
    const file = await this.store.getFile(proof.filePath);
    if (!file) throw notFound('File not found');
    return { file, fileName: proof.fileName ?? 'proof' };
  }

  /* ------------------------------- helpers -------------------------------- */

  private proofPath(orgId: string, taskId: string, fileName: string) {
    const safeName = fileName.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    return `${orgId}/${taskId}/${uuid()}-${safeName}`;
  }

  private async normalizeProofs(task: Task, proofs: ProofInput[]) {
    const out: Array<SystemProof & { filePath: string | null; fileName: string | null }> = [];
    for (const p of proofs) {
      if (p.attestation) {
        const att = await this.drive.readAttestation(p.attestation, task.id);
        out.push({ kind: 'link', url: att.url, note: att.note, source: 'gdrive', verified: att.verified, filePath: null, fileName: att.fileName });
        continue;
      }
      const url = p.url?.trim() || null;
      const note = p.note?.trim() || null;
      if (p.kind === 'link') {
        if (!url) throw badRequest('Link proof needs a URL');
        if (!/^https?:\/\//i.test(url)) throw badRequest('Proof links must start with http:// or https://');
      }
      if (p.kind === 'note' && (!note || note.length < 3)) throw badRequest('Proof note is too short');
      if (p.kind === 'file' && (!p.filePath || !p.filePath.startsWith(`${task.orgId}/${task.id}/`))) throw badRequest('Invalid file reference');
      out.push({
        kind: p.kind === 'file' ? 'link' : p.kind,
        url: p.kind === 'link' ? url : null,
        note,
        source: 'manual',
        verified: false,
        filePath: p.kind === 'file' ? p.filePath! : null,
        fileName: p.kind === 'file' ? (p.fileName?.slice(0, 200) ?? 'file') : null,
      });
    }
    return out;
  }

  private async emit(evt: { type: DomainEvent['type'] } & Record<string, unknown> & { task: Task }) {
    const org = await this.store.getOrg(evt.task.orgId);
    if (org) await this.notifier.dispatch({ ...evt, org } as DomainEvent);
  }

  private async assertDepartment(orgId: string, departmentId: string) {
    const depts = await this.store.listDepartments(orgId);
    if (!depts.some((d) => d.id === departmentId)) throw badRequest('Unknown department');
  }

  async log(orgId: string, actorId: string | null, type: EventType, task: Task | null, meta: Record<string, unknown> = {}, fromStatus: TaskStatus | null = null, toStatus: TaskStatus | null = null) {
    await this.store.appendEvent({
      orgId,
      taskId: task?.id ?? null,
      actorId,
      type,
      fromStatus,
      toStatus,
      meta: task ? { title: task.title, ref: taskRef(task.seq), ...meta } : meta,
    });
  }
}

function endOfToday(): string {
  const d = new Date();
  d.setUTCHours(23, 59, 0, 0);
  return d.toISOString();
}
