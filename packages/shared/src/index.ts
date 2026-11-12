/**
 * @delegate/shared — the domain contract shared by the API and the web app.
 *
 * The task lifecycle is the heart of the product:
 *
 *   open (Red) ──start──▶ in_progress (Amber) ──submit + proof──▶ done (Green) ──audit──▶ approved (Blue ✓)
 *        │                     ▲   │                                   │
 *        └──flag──▶ blocked ───┘   └──flag──▶ blocked                  └──request changes──▶ in_progress
 */

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'approved'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MEMBER_ROLES = ['owner', 'manager', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PROOF_KINDS = ['link', 'note', 'file'] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

export type AiVerdict = 'pass' | 'review' | 'fail';

/** Board lanes. `blocked` shares the amber lane with `in_progress`. */
export const LANES = [
  { id: 'open', label: 'Open', statuses: ['open'] },
  { id: 'active', label: 'In motion', statuses: ['in_progress', 'blocked'] },
  { id: 'done', label: 'Executed', statuses: ['done'] },
  { id: 'approved', label: 'Audited', statuses: ['approved'] },
] as const satisfies ReadonlyArray<{ id: string; label: string; statuses: readonly TaskStatus[] }>;

export const STATUS_META: Record<
  TaskStatus,
  { label: string; tone: 'red' | 'amber' | 'green' | 'blue'; hex: string; description: string }
> = {
  open: { label: 'Open', tone: 'red', hex: '#E5484D', description: 'Assigned and waiting to start' },
  in_progress: { label: 'In progress', tone: 'amber', hex: '#E8A317', description: 'Being executed right now' },
  blocked: { label: 'Blocked', tone: 'amber', hex: '#E8A317', description: 'Stalled on a dependency' },
  done: { label: 'Executed', tone: 'green', hex: '#2F9E6A', description: 'Proof submitted, awaiting audit' },
  approved: { label: 'Audited', tone: 'blue', hex: '#2B7FFF', description: 'Reviewed and closed by management' },
};

export type TransitionAction = 'start' | 'block' | 'unblock' | 'submit' | 'approve' | 'request_changes';

export interface TransitionRule {
  action: TransitionAction;
  from: readonly TaskStatus[];
  to: TaskStatus;
  /** Who may perform it. `assignee` = the person the task is assigned to. */
  actors: ReadonlyArray<'assignee' | 'manager'>;
  label: string;
}

export const TRANSITIONS: Record<TransitionAction, TransitionRule> = {
  start: { action: 'start', from: ['open'], to: 'in_progress', actors: ['assignee', 'manager'], label: 'Start' },
  block: {
    action: 'block',
    from: ['open', 'in_progress'],
    to: 'blocked',
    actors: ['assignee', 'manager'],
    label: 'Flag blocker',
  },
  unblock: { action: 'unblock', from: ['blocked'], to: 'in_progress', actors: ['assignee', 'manager'], label: 'Unblock' },
  submit: {
    action: 'submit',
    from: ['in_progress'],
    to: 'done',
    actors: ['assignee'],
    label: 'Submit proof',
  },
  approve: { action: 'approve', from: ['done'], to: 'approved', actors: ['manager'], label: 'Approve' },
  request_changes: {
    action: 'request_changes',
    from: ['done'],
    to: 'in_progress',
    actors: ['manager'],
    label: 'Request changes',
  },
};

export function isManagerRole(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

/** Which actions can this viewer take on this task right now? Mirrors the API's enforcement. */
export function availableActions(
  task: Pick<Task, 'status' | 'assigneeId'>,
  viewer: { userId: string; role: MemberRole },
): TransitionAction[] {
  const isAssignee = task.assigneeId === viewer.userId;
  const isManager = isManagerRole(viewer.role);
  return (Object.values(TRANSITIONS) as TransitionRule[])
    .filter((rule) => rule.from.includes(task.status))
    .filter(
      (rule) => (rule.actors.includes('assignee') && isAssignee) || (rule.actors.includes('manager') && isManager),
    )
    .filter((rule) => {
      // Four-eyes rule: a manager cannot audit their own work unless they own the workspace.
      if (rule.action === 'approve' && isAssignee && viewer.role !== 'owner') return false;
      return true;
    })
    .map((rule) => rule.action);
}

/* ------------------------------------------------------------------ */
/* Entities (API response shapes, camelCase)                            */
/* ------------------------------------------------------------------ */

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  inviteCode: string;
  plan: 'starter' | 'team' | 'enterprise';
  status: 'active' | 'suspended';
  timezone: string;
  createdAt: string;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Member {
  userId: string;
  orgId: string;
  role: MemberRole;
  departmentId: string | null;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  joinedAt: string;
}

export interface Task {
  id: string;
  orgId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  createdById: string;
  departmentId: string | null;
  dueAt: string | null;
  blockedReason: string | null;
  /** The teammate this task is waiting on (Blocker Ping target). */
  waitingOnId: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskProof {
  id: string;
  taskId: string;
  orgId: string;
  authorId: string;
  kind: ProofKind;
  url: string | null;
  note: string | null;
  fileName: string | null;
  /** Storage path for `file` proofs. Download through the API, never directly. */
  filePath: string | null;
  aiVerdict: AiVerdict | null;
  aiReason: string | null;
  createdAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  orgId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export type EventType =
  | 'task.created'
  | 'task.updated'
  | 'task.started'
  | 'task.blocked'
  | 'task.unblocked'
  | 'task.submitted'
  | 'task.approved'
  | 'task.changes_requested'
  | 'task.commented'
  | 'member.joined'
  | 'member.role_changed'
  | 'org.created';

export interface LedgerEvent {
  id: string;
  orgId: string;
  taskId: string | null;
  actorId: string | null;
  type: EventType;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* API payloads                                                          */
/* ------------------------------------------------------------------ */

export interface AppConfig {
  authMode: 'supabase' | 'demo';
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  aiVerification: boolean;
  version: string;
}

export interface MeResponse {
  profile: Profile;
  membership: { org: Organization; role: MemberRole; departmentId: string | null } | null;
}

export interface TaskDetail {
  task: Task;
  proofs: TaskProof[];
  comments: TaskComment[];
  events: LedgerEvent[];
}

export interface VelocityRow {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  completed: number;
  approved: number;
  /** Average hours from creation (Red) to submission (Green). */
  avgHoursToGreen: number | null;
  onTimeRate: number | null;
  openNow: number;
  blockedNow: number;
}

export interface VelocityResponse {
  windowDays: number;
  team: {
    completed: number;
    avgHoursToGreen: number | null;
    onTimeRate: number | null;
    openNow: number;
    blockedNow: number;
    awaitingAudit: number;
  };
  rows: VelocityRow[];
  /** Completed per day, oldest first. */
  daily: Array<{ date: string; completed: number }>;
}

export interface StandupBrief {
  orgName: string;
  date: string;
  generatedAt: string;
  completedYesterday: Array<{ task: Task; assignee: string }>;
  newToday: Array<{ task: Task; assignee: string }>;
  blockers: Array<{ task: Task; assignee: string; waitingOn: string | null }>;
  overdue: Array<{ task: Task; assignee: string }>;
  awaitingAudit: Array<{ task: Task; assignee: string }>;
}

export interface AdminOverview {
  totals: {
    organizations: number;
    users: number;
    tasks: number;
    events24h: number;
    suspendedOrgs: number;
  };
  byStatus: Record<TaskStatus, number>;
  signupsDaily: Array<{ date: string; count: number }>;
}

export interface AdminOrgRow extends Organization {
  members: number;
  tasks: number;
  lastActivityAt: string | null;
}

export interface AdminUserRow extends Profile {
  orgName: string | null;
  role: MemberRole | null;
}

/** Hours between two ISO timestamps, or null. */
export function hoursBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms >= 0 ? ms / 3_600_000 : null;
}
