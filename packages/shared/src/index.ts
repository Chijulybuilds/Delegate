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
  /** E.164 phone, set once verified over WhatsApp. */
  phone: string | null;
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
  settings: OrgSettings;
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

export const TASK_SOURCES = ['app', 'slack', 'teams', 'whatsapp', 'playbook', 'github'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Human reference used everywhere outside the app: PR titles, WhatsApp, Slack. */
export const TASK_REF_PREFIX = 'DLG';
export const taskRef = (seq: number) => `${TASK_REF_PREFIX}-${seq}`;
/** Matches DLG-123 (case-insensitive) and captures the number. */
export const TASK_REF_PATTERN = /\bDLG-(\d{1,7})\b/gi;

export interface Task {
  id: string;
  orgId: string;
  /** Per-workspace sequence number → DLG-<seq>. */
  seq: number;
  source: TaskSource;
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
  /** When the current blocker was flagged (drives the escalation ladder). */
  blockedAt: string | null;
  /** 0 = none, 1 = managers alerted, 2 = owner alerted. Resets when the task moves. */
  escalationLevel: number;
  overdueAlertedAt: string | null;
  playbookId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PROOF_SOURCES = ['manual', 'github', 'gdrive', 'whatsapp'] as const;
export type ProofSource = (typeof PROOF_SOURCES)[number];

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
  /** Where the proof came from; `verified` = checked against the source system, not just pasted. */
  source: ProofSource;
  verified: boolean;
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
  | 'task.escalated'
  | 'task.proof_attached'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.left'
  | 'org.created'
  | 'billing.updated'
  | 'integration.connected'
  | 'integration.disconnected'
  | 'playbook.ran';

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
  billing: { stripe: boolean; paystack: boolean; demoCheckout: boolean };
  integrations: {
    slack: boolean;
    whatsapp: { enabled: boolean; businessNumber: string | null; simulator: boolean };
    googleDrive: { clientId: string; apiKey: string; appId: string } | null;
  };
  storage: 'api' | 'supabase';
  /** Set when the server is running but its database isn't ready (e.g. a migration hasn't been run). */
  setupIssue: string | null;
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
  billingStatus: SubscriptionStatus;
  billingProvider: BillingProvider | null;
  seats: number;
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

/* ------------------------------------------------------------------ */
/* Workspace settings                                                   */
/* ------------------------------------------------------------------ */

export interface OrgSettings {
  escalation: {
    enabled: boolean;
    /** Blocked longer than this → managers are alerted. */
    blockedManagerHours: number;
    /** Blocked longer than this → the owner is alerted. */
    blockedOwnerHours: number;
    /** Overdue longer than this → assignee + managers are alerted. */
    overdueHours: number;
  };
  digest: {
    enabled: boolean;
    /** Local hour (workspace time zone) for the morning brief. */
    hour: number;
  };
  /** Local date (YYYY-MM-DD) the last morning brief went out — keeps the digest once-a-day. */
  lastDigestOn: string | null;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  escalation: { enabled: true, blockedManagerHours: 4, blockedOwnerHours: 24, overdueHours: 2 },
  digest: { enabled: true, hour: 8 },
  lastDigestOn: null,
};

export function withDefaultSettings(settings: Partial<OrgSettings> | null | undefined): OrgSettings {
  return {
    escalation: { ...DEFAULT_ORG_SETTINGS.escalation, ...(settings?.escalation ?? {}) },
    digest: { ...DEFAULT_ORG_SETTINGS.digest, ...(settings?.digest ?? {}) },
    lastDigestOn: settings?.lastDigestOn ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Plans, subscriptions, entitlements                                   */
/* ------------------------------------------------------------------ */

export const PLAN_IDS = ['starter', 'team', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type BillingProvider = 'stripe' | 'paystack' | 'manual';
export type SubscriptionStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';

export interface Subscription {
  orgId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  provider: BillingProvider | null;
  seats: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  updatedAt: string;
}

export type Feature = 'aiVerification' | 'whatsapp' | 'escalations' | 'playbooks' | 'autoProof' | 'standupEmail';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** null = unlimited (billed per seat). */
  maxMembers: number | null;
  maxPlaybooks: number | null;
  velocityDays: number;
  features: Record<Feature, boolean>;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    maxMembers: 5,
    maxPlaybooks: 1,
    velocityDays: 7,
    features: { aiVerification: false, whatsapp: false, escalations: false, playbooks: true, autoProof: false, standupEmail: false },
  },
  team: {
    id: 'team',
    name: 'Team',
    maxMembers: null,
    maxPlaybooks: null,
    velocityDays: 30,
    features: { aiVerification: true, whatsapp: true, escalations: true, playbooks: true, autoProof: true, standupEmail: true },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    maxMembers: null,
    maxPlaybooks: null,
    velocityDays: 30,
    features: { aiVerification: true, whatsapp: true, escalations: true, playbooks: true, autoProof: true, standupEmail: true },
  },
};

export const TRIAL_DAYS = 14;

export interface Entitlements {
  /** The plan the workspace is paying for (or trialing). */
  plan: PlanId;
  /** The plan whose limits apply right now (falls back to Starter when unpaid). */
  effectivePlan: PlanId;
  status: SubscriptionStatus;
  trialDaysLeft: number | null;
  maxMembers: number | null;
  maxPlaybooks: number | null;
  velocityDays: number;
  features: Record<Feature, boolean>;
}

export function entitlementsFor(sub: Subscription | null, now = new Date()): Entitlements {
  const status: SubscriptionStatus = sub?.status ?? 'none';
  const plan: PlanId = sub?.plan ?? 'starter';
  let paying = status === 'active' || status === 'past_due';
  let trialDaysLeft: number | null = null;
  if (status === 'trialing' && sub?.trialEndsAt) {
    const ms = new Date(sub.trialEndsAt).getTime() - now.getTime();
    trialDaysLeft = Math.max(0, Math.ceil(ms / 86_400_000));
    paying = ms > 0;
  }
  const effectivePlan: PlanId = paying ? plan : 'starter';
  const def = PLANS[effectivePlan];
  return {
    plan,
    effectivePlan,
    status,
    trialDaysLeft,
    maxMembers: def.maxMembers,
    maxPlaybooks: def.maxPlaybooks,
    velocityDays: def.velocityDays,
    features: def.features,
  };
}

export interface BillingOverview {
  subscription: Subscription;
  entitlements: Entitlements;
  members: number;
  prices: { team: { usd: number; ngn: number | null } };
  providers: { stripe: boolean; paystack: boolean; demoCheckout: boolean };
}

/* ------------------------------------------------------------------ */
/* Integrations                                                         */
/* ------------------------------------------------------------------ */

export const INTEGRATION_PROVIDERS = ['slack', 'teams', 'whatsapp', 'github', 'gdrive'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/** Workspace events that can be posted to a Slack/Teams channel. */
export const CHANNEL_EVENTS = ['assigned', 'blocked', 'submitted', 'approved', 'escalated', 'digest'] as const;
export type ChannelEvent = (typeof CHANNEL_EVENTS)[number];

export interface IntegrationSummary {
  provider: IntegrationProvider;
  connected: boolean;
  connectedAt: string | null;
  connectedBy: string | null;
  /** Non-secret details for display (channel, team, masked URLs, webhook URL to paste…). */
  details: Record<string, string | number | boolean | null>;
  events: ChannelEvent[];
  lastError: string | null;
}

export interface OutboundMessage {
  id: string;
  orgId: string;
  channel: 'slack' | 'teams' | 'whatsapp' | 'email';
  target: string;
  summary: string;
  status: 'sent' | 'failed' | 'skipped' | 'simulated';
  error: string | null;
  createdAt: string;
}

export interface IntegrationsOverview {
  integrations: IntegrationSummary[];
  deliveries: OutboundMessage[];
  me: { phone: string | null; whatsappLinkCode: string | null; whatsappLink: string | null };
}

/* ------------------------------------------------------------------ */
/* In-app notifications                                                 */
/* ------------------------------------------------------------------ */

export type NotificationType = 'assigned' | 'blocked_on_you' | 'awaiting_audit' | 'approved' | 'changes_requested' | 'commented' | 'escalated' | 'overdue' | 'auto_proof' | 'billing';

export interface AppNotification {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  taskId: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Recurring playbooks                                                  */
/* ------------------------------------------------------------------ */

export const PLAYBOOK_CADENCES = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type PlaybookCadence = (typeof PLAYBOOK_CADENCES)[number];

export interface PlaybookItem {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  priority: TaskPriority;
  /** Hours after the run time the task is due. */
  dueInHours: number;
}

export interface Playbook {
  id: string;
  orgId: string;
  name: string;
  active: boolean;
  cadence: PlaybookCadence;
  /** 0 = Sunday … 6 = Saturday (weekly). */
  weekday: number | null;
  /** 1–28 (monthly). */
  monthDay: number | null;
  /** HH:MM in the workspace time zone. */
  timeOfDay: string;
  items: PlaybookItem[];
  createdById: string;
  lastRunOn: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Does this playbook run on the given local date (YYYY-MM-DD, weekday 0-6)? */
export function playbookRunsOn(p: Pick<Playbook, 'cadence' | 'weekday' | 'monthDay'>, localDate: string, weekday: number): boolean {
  switch (p.cadence) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekly':
      return weekday === (p.weekday ?? 1);
    case 'monthly':
      return Number(localDate.slice(8, 10)) === (p.monthDay ?? 1);
  }
}

export function describeCadence(p: Pick<Playbook, 'cadence' | 'weekday' | 'monthDay' | 'timeOfDay'>): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const at = `at ${p.timeOfDay}`;
  switch (p.cadence) {
    case 'daily':
      return `Every day ${at}`;
    case 'weekdays':
      return `Weekdays ${at}`;
    case 'weekly':
      return `Every ${days[p.weekday ?? 1]} ${at}`;
    case 'monthly':
      return `Monthly on day ${p.monthDay ?? 1} ${at}`;
  }
}

/** What leaving the workspace / deleting the account would do (GET /api/account/plan). */
export interface LeavePlan {
  role: MemberRole;
  orgName: string;
  /** Other people in the workspace (an owner must hand over to one of them). */
  others: number;
  /** Unfinished tasks that will be handed over. */
  openTasks: number;
  /** Deleting would also delete the whole workspace (sole member). */
  deletesWorkspace: boolean;
  /** A paid subscription blocks deleting the workspace until it's cancelled. */
  paidPlanActive: boolean;
}
