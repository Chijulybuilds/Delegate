import type {
  Department,
  LedgerEvent,
  Member,
  Organization,
  Profile,
  Task,
  TaskComment,
  TaskProof,
  TaskStatus,
} from '@delegate/shared';
import { TASK_STATUSES } from '@delegate/shared';
import { notFound } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
import type { MembershipRecord, NewTask, Store, TaskPatch } from './types.js';

const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

/** In-process store used for the demo workspace, local development and tests. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;

  profiles = new Map<string, Profile>();
  orgs = new Map<string, Organization>();
  memberships: MembershipRecord[] = [];
  departments = new Map<string, Department>();
  tasks = new Map<string, Task>();
  proofs = new Map<string, TaskProof>();
  comments = new Map<string, TaskComment>();
  events: LedgerEvent[] = [];
  files = new Map<string, { data: Buffer; contentType: string }>();
  private eventSeq = 0;

  reset() {
    this.profiles.clear();
    this.orgs.clear();
    this.memberships = [];
    this.departments.clear();
    this.tasks.clear();
    this.proofs.clear();
    this.comments.clear();
    this.events = [];
    this.files.clear();
    this.eventSeq = 0;
  }

  // Profiles ---------------------------------------------------------------
  async getProfile(id: string) {
    const p = this.profiles.get(id);
    return p ? clone(p) : null;
  }
  async getProfileByEmail(email: string) {
    const needle = email.toLowerCase();
    const p = [...this.profiles.values()].find((x) => x.email.toLowerCase() === needle);
    return p ? clone(p) : null;
  }
  async upsertProfile(input: { id: string; email: string; fullName: string; avatarUrl: string | null }) {
    const existing = this.profiles.get(input.id);
    const next: Profile = existing
      ? { ...existing, email: input.email, fullName: input.fullName || existing.fullName, avatarUrl: input.avatarUrl ?? existing.avatarUrl }
      : { ...input, status: 'active', createdAt: now() };
    this.profiles.set(input.id, next);
    return clone(next);
  }
  async listProfiles() {
    return [...this.profiles.values()].map(clone);
  }
  async setProfileStatus(id: string, status: Profile['status']) {
    const p = this.profiles.get(id);
    if (!p) throw notFound('User not found');
    p.status = status;
  }

  // Organizations ----------------------------------------------------------
  async createOrg(input: Pick<Organization, 'name' | 'slug' | 'inviteCode' | 'timezone'>) {
    const org: Organization = { id: uuid(), ...input, plan: 'starter', status: 'active', createdAt: now() };
    this.orgs.set(org.id, org);
    return clone(org);
  }
  async getOrg(id: string) {
    const o = this.orgs.get(id);
    return o ? clone(o) : null;
  }
  async getOrgByInviteCode(code: string) {
    const o = [...this.orgs.values()].find((x) => x.inviteCode.toUpperCase() === code.toUpperCase());
    return o ? clone(o) : null;
  }
  async slugExists(slug: string) {
    return [...this.orgs.values()].some((o) => o.slug === slug);
  }
  async listOrgs() {
    return [...this.orgs.values()].map(clone);
  }
  async updateOrg(id: string, patch: Partial<Pick<Organization, 'name' | 'status' | 'plan' | 'inviteCode' | 'timezone'>>) {
    const o = this.orgs.get(id);
    if (!o) throw notFound('Workspace not found');
    Object.assign(o, patch);
    return clone(o);
  }

  // Memberships ------------------------------------------------------------
  async getMembershipForUser(userId: string) {
    const m = this.memberships.find((x) => x.userId === userId);
    return m ? clone(m) : null;
  }
  async listMemberships(orgId?: string) {
    return this.memberships.filter((m) => !orgId || m.orgId === orgId).map(clone);
  }
  async listMembers(orgId: string): Promise<Member[]> {
    return this.memberships
      .filter((m) => m.orgId === orgId)
      .map((m) => {
        const p = this.profiles.get(m.userId);
        return {
          userId: m.userId,
          orgId: m.orgId,
          role: m.role,
          departmentId: m.departmentId,
          fullName: p?.fullName ?? 'Unknown',
          email: p?.email ?? '',
          avatarUrl: p?.avatarUrl ?? null,
          joinedAt: m.joinedAt,
        };
      });
  }
  async addMember(input: Omit<MembershipRecord, 'joinedAt'>) {
    if (this.memberships.some((m) => m.userId === input.userId)) return;
    this.memberships.push({ ...input, joinedAt: now() });
  }
  async updateMember(orgId: string, userId: string, patch: Partial<Pick<MembershipRecord, 'role' | 'departmentId'>>) {
    const m = this.memberships.find((x) => x.orgId === orgId && x.userId === userId);
    if (!m) throw notFound('Member not found');
    Object.assign(m, patch);
  }

  // Departments --------------------------------------------------------------
  async listDepartments(orgId: string) {
    return [...this.departments.values()].filter((d) => d.orgId === orgId).map(clone);
  }
  async createDepartment(input: Pick<Department, 'orgId' | 'name' | 'color'>) {
    const d: Department = { id: uuid(), ...input, createdAt: now() };
    this.departments.set(d.id, d);
    return clone(d);
  }

  // Tasks ------------------------------------------------------------------
  async listTasks(query: { orgId?: string }) {
    return [...this.tasks.values()]
      .filter((t) => !query.orgId || t.orgId === query.orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }
  async getTask(id: string) {
    const t = this.tasks.get(id);
    return t ? clone(t) : null;
  }
  async insertTask(input: NewTask & { createdAt?: string }) {
    const ts = input.createdAt ?? now();
    const t: Task = { ...input, id: uuid(), createdAt: ts, updatedAt: ts };
    this.tasks.set(t.id, t);
    return clone(t);
  }
  async updateTask(id: string, patch: TaskPatch) {
    const t = this.tasks.get(id);
    if (!t) throw notFound('Task not found');
    Object.assign(t, patch, { updatedAt: now() });
    return clone(t);
  }

  async countTasksByStatus(orgId?: string) {
    const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const t of this.tasks.values()) if (!orgId || t.orgId === orgId) counts[t.status] += 1;
    return counts;
  }

  async orgStats() {
    return [...this.orgs.values()].map((o) => {
      const last = this.events.filter((e) => e.orgId === o.id).reduce<string | null>((acc, e) => (!acc || e.createdAt > acc ? e.createdAt : acc), null);
      return {
        orgId: o.id,
        members: this.memberships.filter((m) => m.orgId === o.id).length,
        tasks: [...this.tasks.values()].filter((t) => t.orgId === o.id).length,
        lastActivityAt: last,
      };
    });
  }

  // Proofs & comments --------------------------------------------------------
  async listProofs(taskId: string) {
    return [...this.proofs.values()]
      .filter((p) => p.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
  async listProofsForOrg(orgId: string) {
    return [...this.proofs.values()].filter((p) => p.orgId === orgId).map(clone);
  }
  async insertProof(input: Omit<TaskProof, 'id' | 'createdAt'> & { createdAt?: string }) {
    const p: TaskProof = { ...input, id: uuid(), createdAt: input.createdAt ?? now() };
    this.proofs.set(p.id, p);
    return clone(p);
  }
  async listComments(taskId: string) {
    return [...this.comments.values()]
      .filter((c) => c.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
  async insertComment(input: Omit<TaskComment, 'id' | 'createdAt'> & { createdAt?: string }) {
    const c: TaskComment = { ...input, id: uuid(), createdAt: input.createdAt ?? now() };
    this.comments.set(c.id, c);
    return clone(c);
  }

  // Ledger (append-only) ------------------------------------------------------
  async appendEvent(input: Omit<LedgerEvent, 'id' | 'createdAt'> & { createdAt?: string }) {
    this.eventSeq += 1;
    const e: LedgerEvent = Object.freeze({
      ...input,
      id: String(this.eventSeq),
      createdAt: input.createdAt ?? now(),
    }) as LedgerEvent;
    this.events.push(e);
    return clone(e);
  }
  async listEvents(query: { orgId?: string; taskId?: string; before?: string; limit: number }) {
    return this.events
      .filter((e) => (!query.orgId || e.orgId === query.orgId) && (!query.taskId || e.taskId === query.taskId))
      .filter((e) => !query.before || e.createdAt < query.before)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id))
      .slice(0, query.limit)
      .map(clone);
  }
  async countEventsSince(iso: string) {
    return this.events.filter((e) => e.createdAt >= iso).length;
  }

  // Files ------------------------------------------------------------------
  async putFile(path: string, data: Buffer, contentType: string) {
    this.files.set(path, { data, contentType });
  }
  async getFile(path: string) {
    return this.files.get(path) ?? null;
  }
}
