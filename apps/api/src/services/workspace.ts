import {
  availableActions,
  isManagerRole,
  TRANSITIONS,
  type EventType,
  type MemberRole,
  type Organization,
  type Profile,
  type Task,
  type TaskDetail,
  type TaskPriority,
  type TaskProof,
  type TaskStatus,
  type TransitionAction,
} from '@delegate/shared';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { inviteCode, slugify, uuid } from '../lib/ids.js';
import type { Store } from '../store/types.js';
import type { ProofVerifier } from './ai.js';

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

const DEFAULT_DEPARTMENTS: Array<[string, string]> = [
  ['Operations', '#6E56CF'],
  ['Engineering', '#0EA5A4'],
  ['Creative', '#D9480F'],
];

/** Board shows everything still moving plus recently audited work. */
const BOARD_APPROVED_WINDOW_MS = 14 * 86_400_000;

export class WorkspaceService {
  constructor(
    private store: Store,
    private verifier: ProofVerifier,
  ) {}

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
    });
    const depts = await Promise.all(
      DEFAULT_DEPARTMENTS.map(([name, color]) => this.store.createDepartment({ orgId: org.id, name, color })),
    );
    await this.store.addMember({ orgId: org.id, userId: user.id, role: 'owner', departmentId: depts[0]?.id ?? null });
    await this.log(org.id, user.id, 'org.created', null, { name: org.name });
    return org;
  }

  async joinWorkspace(user: Profile, code: string): Promise<Organization> {
    if (await this.store.getMembershipForUser(user.id)) throw conflict('You already belong to a workspace');
    const org = await this.store.getOrgByInviteCode(code.trim());
    if (!org) throw notFound('That invite code does not match any workspace');
    if (org.status === 'suspended') throw forbidden('This workspace is suspended');
    await this.store.addMember({ orgId: org.id, userId: user.id, role: 'member', departmentId: null });
    await this.log(org.id, user.id, 'member.joined', null, { name: user.fullName });
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
      await this.log(ctx.orgId, ctx.userId, 'member.role_changed', null, {
        userId,
        name: target.fullName,
        from: target.role,
        to: patch.role,
      });
    }
  }

  async createDepartment(ctx: Ctx, input: { name: string; color?: string }) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can add departments');
    const existing = await this.store.listDepartments(ctx.orgId);
    if (existing.some((d) => d.name.toLowerCase() === input.name.trim().toLowerCase())) {
      throw conflict('A department with that name already exists');
    }
    return this.store.createDepartment({ orgId: ctx.orgId, name: input.name.trim(), color: input.color || '#6B7280' });
  }

  async updateOrg(ctx: Ctx, patch: { name?: string; timezone?: string; regenerateInvite?: boolean }) {
    if (!isManagerRole(ctx.role)) throw forbidden('Only managers can change workspace settings');
    if (patch.name !== undefined && ctx.role !== 'owner') throw forbidden('Only the owner can rename the workspace');
    const org = await this.store.getOrg(ctx.orgId);
    if (!org) throw notFound('Workspace not found');
    return this.store.updateOrg(ctx.orgId, {
      ...(patch.name ? { name: patch.name.trim() } : {}),
      ...(patch.timezone ? { timezone: patch.timezone } : {}),
      ...(patch.regenerateInvite ? { inviteCode: inviteCode(org.name) } : {}),
    });
  }

  /* -------------------------------- Tasks --------------------------------- */

  async listBoard(ctx: Ctx): Promise<{ tasks: Task[]; aiVerdicts: Record<string, TaskProof['aiVerdict']> }> {
    const cutoff = new Date(Date.now() - BOARD_APPROVED_WINDOW_MS).toISOString();
    const tasks = (await this.store.listTasks({ orgId: ctx.orgId })).filter(
      (t) => t.status !== 'approved' || (t.approvedAt ?? t.updatedAt) >= cutoff,
    );
    // Latest AI verdict per task, so the board can badge green cards without N+1 calls.
    const proofs = await this.store.listProofsForOrg(ctx.orgId);
    const aiVerdicts: Record<string, TaskProof['aiVerdict']> = {};
    for (const p of proofs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (p.aiVerdict) aiVerdicts[p.taskId] = p.aiVerdict;
    }
    return { tasks, aiVerdicts };
  }

  async getTaskForCtx(ctx: Ctx, id: string): Promise<Task> {
    const task = await this.store.getTask(id);
    // Same 404 for "missing" and "other tenant" so IDs can't be probed across workspaces.
    if (!task || task.orgId !== ctx.orgId) throw notFound('Task not found');
    return task;
  }

  async detail(ctx: Ctx, id: string): Promise<TaskDetail> {
    const task = await this.getTaskForCtx(ctx, id);
    const [proofs, comments, events] = await Promise.all([
      this.store.listProofs(id),
      this.store.listComments(id),
      this.store.listEvents({ taskId: id, limit: 100 }),
    ]);
    return { task, proofs, comments, events };
  }

  async createTask(ctx: Ctx, input: CreateTaskInput): Promise<Task> {
    const members = await this.store.listMembers(ctx.orgId);
    const assigneeId = input.assigneeId ?? ctx.userId;
    const assignee = members.find((m) => m.userId === assigneeId);
    if (!assignee) throw badRequest('Assignee must be a member of this workspace');
    if (!isManagerRole(ctx.role) && assigneeId !== ctx.userId) {
      throw forbidden('Only managers can assign tasks to teammates');
    }
    const departmentId = input.departmentId === undefined ? assignee.departmentId : input.departmentId;
    if (departmentId) await this.assertDepartment(ctx.orgId, departmentId);

    const task = await this.store.insertTask({
      orgId: ctx.orgId,
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      status: 'open',
      priority: input.priority ?? 'medium',
      assigneeId,
      createdById: ctx.userId,
      departmentId: departmentId ?? null,
      dueAt: input.dueAt ?? endOfToday(),
      blockedReason: null,
      waitingOnId: null,
      startedAt: null,
      submittedAt: null,
      approvedAt: null,
      approvedById: null,
    });
    await this.log(ctx.orgId, ctx.userId, 'task.created', task, { assigneeId }, null, 'open');
    return task;
  }

  async updateTask(ctx: Ctx, id: string, patch: Partial<CreateTaskInput>): Promise<Task> {
    const task = await this.getTaskForCtx(ctx, id);
    if (!isManagerRole(ctx.role) && task.createdById !== ctx.userId) {
      throw forbidden('Only managers or the task creator can edit this task');
    }
    if (task.status === 'approved') throw conflict('Audited tasks are locked');
    const next: Partial<Task> = {};
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.description !== undefined) next.description = patch.description.trim();
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
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
    const changed = Object.keys(next).filter((k) => next[k as keyof Task] !== task[k as keyof Task]);
    if (changed.length === 0) return task;
    const updated = await this.store.updateTask(id, next);
    await this.log(ctx.orgId, ctx.userId, 'task.updated', updated, { fields: changed });
    return updated;
  }

  async transition(ctx: Ctx, id: string, action: TransitionAction, input: TransitionInput): Promise<TaskDetail> {
    const task = await this.getTaskForCtx(ctx, id);
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(task.status)) {
      throw new HttpError(409, `Cannot ${rule.label.toLowerCase()} a task that is ${task.status.replace('_', ' ')}`, 'invalid_transition');
    }
    if (!availableActions(task, { userId: ctx.userId, role: ctx.role }).includes(action)) {
      if (action === 'approve' && task.assigneeId === ctx.userId) {
        throw forbidden('You cannot audit your own work — ask another manager');
      }
      throw forbidden(rule.actors.includes('assignee') && !rule.actors.includes('manager') ? 'Only the assignee can do that' : 'Only managers can do that');
    }

    const now = new Date().toISOString();
    const patch: Partial<Task> = { status: rule.to };
    const meta: Record<string, unknown> = {};
    let eventType: EventType;

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
          const members = await this.store.listMembers(ctx.orgId);
          if (!members.some((m) => m.userId === input.waitingOnId)) throw badRequest('That teammate is not in this workspace');
        }
        patch.blockedReason = reason;
        patch.waitingOnId = input.waitingOnId ?? null;
        patch.startedAt = task.startedAt ?? now;
        Object.assign(meta, { reason, waitingOnId: input.waitingOnId ?? null });
        eventType = 'task.blocked';
        break;
      }

      case 'unblock':
        patch.blockedReason = null;
        patch.waitingOnId = null;
        eventType = 'task.unblocked';
        break;

      case 'submit': {
        const proofs = (input.proofs ?? []).map((p) => normalizeProof(p, task));
        if (proofs.length === 0) throw badRequest('Attach at least one proof of work (link, note or file)');
        const ai = this.verifier.enabled
          ? await this.verifier.check({ title: task.title, description: task.description, proofs: proofs.map((p) => ({ ...p })) })
          : null;
        for (const p of proofs) {
          await this.store.insertProof({
            taskId: task.id,
            orgId: ctx.orgId,
            authorId: ctx.userId,
            kind: p.kind,
            url: p.url,
            note: p.note,
            fileName: p.fileName,
            filePath: p.filePath,
            aiVerdict: ai?.verdict ?? null,
            aiReason: ai?.reason ?? null,
          });
        }
        patch.submittedAt = now;
        Object.assign(meta, { proofCount: proofs.length, aiVerdict: ai?.verdict ?? null });
        eventType = 'task.submitted';
        break;
      }

      case 'approve':
        patch.approvedAt = now;
        patch.approvedById = ctx.userId;
        eventType = 'task.approved';
        break;

      case 'request_changes': {
        const comment = input.comment?.trim();
        if (!comment) throw badRequest('Tell the assignee what needs to change');
        await this.store.insertComment({ taskId: task.id, orgId: ctx.orgId, authorId: ctx.userId, body: comment });
        patch.submittedAt = null;
        Object.assign(meta, { comment });
        eventType = 'task.changes_requested';
        break;
      }
    }

    const updated = await this.store.updateTask(task.id, patch);
    await this.log(ctx.orgId, ctx.userId, eventType, updated, meta, task.status, rule.to);
    return this.detail(ctx, task.id);
  }

  async comment(ctx: Ctx, id: string, body: string) {
    const task = await this.getTaskForCtx(ctx, id);
    const comment = await this.store.insertComment({ taskId: task.id, orgId: ctx.orgId, authorId: ctx.userId, body: body.trim() });
    await this.log(ctx.orgId, ctx.userId, 'task.commented', task, { preview: body.trim().slice(0, 140) });
    return comment;
  }

  /** Stores a file for a later `submit` and returns the reference to include in the proof. */
  async uploadProofFile(ctx: Ctx, id: string, file: { originalname: string; mimetype: string; buffer: Buffer }) {
    const task = await this.getTaskForCtx(ctx, id);
    if (task.assigneeId !== ctx.userId) throw forbidden('Only the assignee can attach proof');
    if (!['in_progress'].includes(task.status)) throw conflict('Start the task before attaching proof');
    const safeName = file.originalname.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    const filePath = `${ctx.orgId}/${task.id}/${uuid()}-${safeName}`;
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

  private async assertDepartment(orgId: string, departmentId: string) {
    const depts = await this.store.listDepartments(orgId);
    if (!depts.some((d) => d.id === departmentId)) throw badRequest('Unknown department');
  }

  private async log(
    orgId: string,
    actorId: string,
    type: EventType,
    task: Task | null,
    meta: Record<string, unknown> = {},
    fromStatus: TaskStatus | null = null,
    toStatus: TaskStatus | null = null,
  ) {
    await this.store.appendEvent({
      orgId,
      taskId: task?.id ?? null,
      actorId,
      type,
      fromStatus,
      toStatus,
      meta: task ? { title: task.title, ...meta } : meta,
    });
  }
}

function normalizeProof(p: ProofInput, task: Task) {
  const url = p.url?.trim() || null;
  const note = p.note?.trim() || null;
  if (p.kind === 'link') {
    if (!url) throw badRequest('Link proof needs a URL');
    if (!/^https?:\/\//i.test(url)) throw badRequest('Proof links must start with http:// or https://');
  }
  if (p.kind === 'note' && (!note || note.length < 3)) throw badRequest('Proof note is too short');
  if (p.kind === 'file') {
    // Files must have been uploaded for this exact task (path is scoped org/task/...).
    if (!p.filePath || !p.filePath.startsWith(`${task.orgId}/${task.id}/`)) throw badRequest('Invalid file reference');
  }
  return {
    kind: p.kind,
    url: p.kind === 'link' ? url : null,
    note: note,
    filePath: p.kind === 'file' ? p.filePath! : null,
    fileName: p.kind === 'file' ? (p.fileName?.slice(0, 200) ?? 'file') : null,
  };
}

function endOfToday(): string {
  const d = new Date();
  d.setUTCHours(23, 59, 0, 0);
  return d.toISOString();
}
