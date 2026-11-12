import type {
  Department,
  LedgerEvent,
  Member,
  MemberRole,
  Organization,
  Profile,
  Task,
  TaskComment,
  TaskStatus,
  TaskProof,
} from '@delegate/shared';

export interface MembershipRecord {
  orgId: string;
  userId: string;
  role: MemberRole;
  departmentId: string | null;
  joinedAt: string;
}

export type NewTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
export type TaskPatch = Partial<Omit<Task, 'id' | 'orgId' | 'createdAt' | 'createdById'>>;

/**
 * Persistence boundary. Business rules live in the services layer; a Store only reads and
 * writes rows. Two implementations ship: an in-memory store (demo + tests) and Supabase.
 */
export interface Store {
  readonly kind: 'memory' | 'supabase';

  // Profiles
  getProfile(id: string): Promise<Profile | null>;
  getProfileByEmail(email: string): Promise<Profile | null>;
  upsertProfile(input: { id: string; email: string; fullName: string; avatarUrl: string | null }): Promise<Profile>;
  listProfiles(): Promise<Profile[]>;
  setProfileStatus(id: string, status: Profile['status']): Promise<void>;

  // Organizations
  createOrg(input: Pick<Organization, 'name' | 'slug' | 'inviteCode' | 'timezone'>): Promise<Organization>;
  getOrg(id: string): Promise<Organization | null>;
  getOrgByInviteCode(code: string): Promise<Organization | null>;
  slugExists(slug: string): Promise<boolean>;
  listOrgs(): Promise<Organization[]>;
  updateOrg(id: string, patch: Partial<Pick<Organization, 'name' | 'status' | 'plan' | 'inviteCode' | 'timezone'>>): Promise<Organization>;

  // Memberships (MVP: one workspace per user)
  getMembershipForUser(userId: string): Promise<MembershipRecord | null>;
  listMemberships(orgId?: string): Promise<MembershipRecord[]>;
  listMembers(orgId: string): Promise<Member[]>;
  addMember(input: Omit<MembershipRecord, 'joinedAt'>): Promise<void>;
  updateMember(orgId: string, userId: string, patch: Partial<Pick<MembershipRecord, 'role' | 'departmentId'>>): Promise<void>;

  // Departments
  listDepartments(orgId: string): Promise<Department[]>;
  createDepartment(input: Pick<Department, 'orgId' | 'name' | 'color'>): Promise<Department>;

  // Tasks
  listTasks(query: { orgId?: string }): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  insertTask(input: NewTask): Promise<Task>;
  updateTask(id: string, patch: TaskPatch): Promise<Task>;

  countTasksByStatus(orgId?: string): Promise<Record<TaskStatus, number>>;

  // Platform aggregates (admin console)
  orgStats(): Promise<Array<{ orgId: string; members: number; tasks: number; lastActivityAt: string | null }>>;

  // Proof of work + micro-chat
  listProofs(taskId: string): Promise<TaskProof[]>;
  listProofsForOrg(orgId: string): Promise<TaskProof[]>;
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
}
