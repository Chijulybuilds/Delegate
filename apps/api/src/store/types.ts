import type {
  AppNotification,
  ChannelEvent,
  Department,
  IntegrationProvider,
  LedgerEvent,
  Member,
  MemberRole,
  Organization,
  OutboundMessage,
  Playbook,
  Profile,
  Subscription,
  Task,
  TaskComment,
  TaskProof,
  TaskStatus,
} from '@delegate/shared';

export interface MembershipRecord {
  orgId: string;
  userId: string;
  role: MemberRole;
  departmentId: string | null;
  joinedAt: string;
}

/** `seq` is assigned by the store. `occurrenceKey` makes recurring creation idempotent. */
export type NewTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'seq'> & { occurrenceKey?: string | null };
export type TaskPatch = Partial<Omit<Task, 'id' | 'orgId' | 'createdAt' | 'createdById' | 'seq'>>;

export interface IntegrationRecord {
  id: string;
  orgId: string;
  provider: IntegrationProvider;
  /** Non-secret configuration (team name, channel, masked URL…). */
  config: Record<string, unknown>;
  /** AES-256-GCM encrypted JSON of secrets (tokens, webhook URLs, signing keys). */
  secret: string | null;
  events: ChannelEvent[];
  status: 'connected' | 'error';
  lastError: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persistence boundary. Business rules live in the services layer; a Store only reads and
 * writes rows. Two implementations ship: an in-memory store (demo + tests) and Supabase.
 */
export interface Store {
  readonly kind: 'memory' | 'supabase';
  /** Plain-language description of a database that is missing a migration, or null when it is up to date. */
  checkSchema?(): Promise<string | null>;
  /** Features that need a newer database than the app can run on. Absent = everything available. */
  features?(): { taskSize: boolean };

  // Profiles
  getProfile(id: string): Promise<Profile | null>;
  getProfileByEmail(email: string): Promise<Profile | null>;
  getProfileByPhone(phone: string): Promise<Profile | null>;
  upsertProfile(input: { id: string; email: string; fullName: string; avatarUrl: string | null }): Promise<Profile>;
  listProfiles(): Promise<Profile[]>;
  setProfileStatus(id: string, status: Profile['status']): Promise<void>;
  setProfilePhone(id: string, phone: string | null): Promise<void>;

  // Organizations
  createOrg(input: Pick<Organization, 'name' | 'slug' | 'inviteCode' | 'timezone' | 'settings'>): Promise<Organization>;
  getOrg(id: string): Promise<Organization | null>;
  getOrgByInviteCode(code: string): Promise<Organization | null>;
  slugExists(slug: string): Promise<boolean>;
  listOrgs(): Promise<Organization[]>;
  updateOrg(
    id: string,
    patch: Partial<Pick<Organization, 'name' | 'status' | 'plan' | 'inviteCode' | 'timezone' | 'settings'>>,
  ): Promise<Organization>;

  // Memberships (MVP: one workspace per user)
  getMembershipForUser(userId: string): Promise<MembershipRecord | null>;
  listMemberships(orgId?: string): Promise<MembershipRecord[]>;
  listMembers(orgId: string): Promise<Member[]>;
  addMember(input: Omit<MembershipRecord, 'joinedAt'>): Promise<void>;
  updateMember(orgId: string, userId: string, patch: Partial<Pick<MembershipRecord, 'role' | 'departmentId'>>): Promise<void>;
  removeMember(orgId: string, userId: string): Promise<void>;

  // Leaving for good
  /** Deletes a workspace and everything in it: tasks, ledger, files, billing records, integrations. */
  deleteOrg(orgId: string): Promise<void>;
  /** Erases a person: anonymises their profile and removes their sign-in. Past work stays, shown as "Deleted user". */
  eraseUser(userId: string): Promise<void>;

  // Departments
  listDepartments(orgId: string): Promise<Department[]>;
  createDepartment(input: Pick<Department, 'orgId' | 'name' | 'color'>): Promise<Department>;

  // Tasks
  /** Newest first. `createdSince` (ISO) keeps only tasks given out from then on. */
  listTasks(query: { orgId?: string; statuses?: TaskStatus[]; createdSince?: string }): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  getTaskBySeq(orgId: string, seq: number): Promise<Task | null>;
  /** Throws HttpError 409 `duplicate_occurrence` when `occurrenceKey` was already used. */
  insertTask(input: NewTask): Promise<Task>;
  updateTask(id: string, patch: TaskPatch): Promise<Task>;
  countTasksByStatus(orgId?: string): Promise<Record<TaskStatus, number>>;

  // Platform aggregates (admin console)
  orgStats(): Promise<Array<{ orgId: string; members: number; tasks: number; lastActivityAt: string | null }>>;

  // Proof of work + micro-chat
  listProofs(taskId: string): Promise<TaskProof[]>;
  listProofsForOrg(orgId: string): Promise<TaskProof[]>;
  listProofsForTasks(taskIds: string[]): Promise<TaskProof[]>;
  insertProof(input: Omit<TaskProof, 'id' | 'createdAt'>): Promise<TaskProof>;
  listComments(taskId: string): Promise<TaskComment[]>;
  insertComment(input: Omit<TaskComment, 'id' | 'createdAt'>): Promise<TaskComment>;

  // Immutable activity ledger
  appendEvent(input: Omit<LedgerEvent, 'id' | 'createdAt'>): Promise<LedgerEvent>;
  listEvents(query: { orgId?: string; taskId?: string; before?: string; limit: number }): Promise<LedgerEvent[]>;
  countEventsSince(iso: string): Promise<number>;

  // Proof files
  putFile(path: string, data: Buffer, contentType: string): Promise<void>;
  /** Returns either the bytes (memory) or a short-lived signed URL (Supabase). */
  getFile(path: string): Promise<{ data: Buffer; contentType: string } | { url: string } | null>;
  /** Direct browser → storage upload (Supabase). null = the store wants uploads through the API. */
  createUploadUrl(path: string): Promise<{ signedUrl: string; token: string; bucket: string } | null>;

  // Billing
  getSubscription(orgId: string): Promise<Subscription | null>;
  listSubscriptions(): Promise<Subscription[]>;
  upsertSubscription(sub: Subscription): Promise<Subscription>;
  findSubscription(by: 'customer' | 'subscription', providerId: string): Promise<Subscription | null>;
  /** Idempotency for webhooks: true the first time an event id is seen, false on replays. */
  recordWebhookEvent(provider: string, eventId: string): Promise<boolean>;

  // Integrations
  listIntegrations(orgId: string): Promise<IntegrationRecord[]>;
  getIntegration(id: string): Promise<IntegrationRecord | null>;
  getIntegrationFor(orgId: string, provider: IntegrationProvider): Promise<IntegrationRecord | null>;
  findIntegrationByConfig(provider: IntegrationProvider, key: string, value: string): Promise<IntegrationRecord | null>;
  saveIntegration(rec: Omit<IntegrationRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<IntegrationRecord>;
  deleteIntegration(id: string): Promise<void>;
  logOutbound(msg: Omit<OutboundMessage, 'id' | 'createdAt'>): Promise<void>;
  listOutbound(orgId: string, limit: number): Promise<OutboundMessage[]>;

  // WhatsApp phone linking
  createLinkCode(input: { code: string; userId: string; orgId: string; expiresAt: string }): Promise<void>;
  getActiveLinkCode(userId: string): Promise<{ code: string; expiresAt: string } | null>;
  consumeLinkCode(code: string): Promise<{ userId: string; orgId: string } | null>;

  // In-app notifications
  insertNotifications(list: Array<Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>>): Promise<void>;
  /** Newest first. `general` = only those not about a task (task news shows on the task itself). */
  listNotifications(userId: string, limit: number, scope?: 'all' | 'general'): Promise<AppNotification[]>;
  /** Every unread notification of the person (newest first, capped). */
  listUnreadNotifications(userId: string): Promise<AppNotification[]>;
  /** `'all'` marks the general ones read; `{ taskId }` everything about that task. */
  markNotificationsRead(userId: string, ids: string[] | 'all' | { taskId: string }): Promise<void>;

  // Playbooks
  listPlaybooks(orgId?: string): Promise<Playbook[]>;
  getPlaybook(id: string): Promise<Playbook | null>;
  savePlaybook(p: Omit<Playbook, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Playbook>;
  deletePlaybook(id: string): Promise<void>;
}

/** What an erased person's profile becomes: no name, no email, no photo, no phone, and no way to sign in. */
export function erasedProfile(userId: string) {
  return {
    fullName: 'Deleted user',
    email: `deleted-${userId.slice(0, 8)}@deleted.invalid`,
    avatarUrl: null,
    phone: null,
    status: 'suspended' as const,
  };
}
