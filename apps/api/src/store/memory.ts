import {
  DEFAULT_ORG_SETTINGS,
  TASK_STATUSES,
  type AppNotification,
  type Department,
  type IntegrationProvider,
  type LedgerEvent,
  type Member,
  type Organization,
  type OutboundMessage,
  type Playbook,
  type Profile,
  type Subscription,
  type Task,
  type TaskComment,
  type TaskProof,
  type TaskStatus,
} from '@delegate/shared';
import { HttpError, notFound } from '../lib/errors.js';
import { uuid } from '../lib/ids.js';
import { erasedProfile } from './types.js';
import type { IntegrationRecord, MembershipRecord, NewTask, Store, TaskPatch } from './types.js';

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
  occurrences = new Set<string>();
  proofs = new Map<string, TaskProof>();
  comments = new Map<string, TaskComment>();
  events: LedgerEvent[] = [];
  files = new Map<string, { data: Buffer; contentType: string }>();
  subscriptions = new Map<string, Subscription>();
  webhookEvents = new Set<string>();
  integrations = new Map<string, IntegrationRecord>();
  outbound: OutboundMessage[] = [];
  linkCodes: Array<{ code: string; userId: string; orgId: string; expiresAt: string; usedAt: string | null }> = [];
  notifications: AppNotification[] = [];
  playbooks = new Map<string, Playbook>();
  private eventSeq = 0;
  private taskSeq = new Map<string, number>();

  reset() {
    this.profiles.clear();
    this.orgs.clear();
    this.memberships = [];
    this.departments.clear();
    this.tasks.clear();
    this.occurrences.clear();
    this.proofs.clear();
    this.comments.clear();
    this.events = [];
    this.files.clear();
    this.subscriptions.clear();
    this.webhookEvents.clear();
    this.integrations.clear();
    this.outbound = [];
    this.linkCodes = [];
    this.notifications = [];
    this.playbooks.clear();
    this.eventSeq = 0;
    this.taskSeq.clear();
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
  async getProfileByPhone(phone: string) {
    const p = [...this.profiles.values()].find((x) => x.phone === phone);
    return p ? clone(p) : null;
  }
  async upsertProfile(input: { id: string; email: string; fullName: string; avatarUrl: string | null }) {
    const existing = this.profiles.get(input.id);
    const next: Profile = existing
      ? { ...existing, email: input.email, fullName: input.fullName || existing.fullName, avatarUrl: input.avatarUrl ?? existing.avatarUrl }
      : { ...input, phone: null, status: 'active', createdAt: now() };
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
  async setProfilePhone(id: string, phone: string | null) {
    const p = this.profiles.get(id);
    if (!p) throw notFound('User not found');
    // A phone belongs to one person: unlink it anywhere else first.
    if (phone) for (const other of this.profiles.values()) if (other.phone === phone) other.phone = null;
    p.phone = phone;
  }

  // Organizations ----------------------------------------------------------
  async createOrg(input: Pick<Organization, 'name' | 'slug' | 'inviteCode' | 'timezone' | 'settings'>) {
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
  async updateOrg(id: string, patch: Partial<Pick<Organization, 'name' | 'status' | 'plan' | 'inviteCode' | 'timezone' | 'settings'>>) {
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
  async removeMember(orgId: string, userId: string) {
    this.memberships = this.memberships.filter((m) => !(m.orgId === orgId && m.userId === userId));
  }

  async deleteOrg(orgId: string) {
    const taskIds = new Set([...this.tasks.values()].filter((t) => t.orgId === orgId).map((t) => t.id));
    this.orgs.delete(orgId);
    this.memberships = this.memberships.filter((m) => m.orgId !== orgId);
    for (const [id, d] of this.departments) if (d.orgId === orgId) this.departments.delete(id);
    for (const id of taskIds) this.tasks.delete(id);
    for (const [id, p] of this.proofs) if (taskIds.has(p.taskId)) this.proofs.delete(id);
    for (const [id, c] of this.comments) if (taskIds.has(c.taskId)) this.comments.delete(id);
    this.events = this.events.filter((e) => e.orgId !== orgId);
    for (const key of [...this.files.keys()]) if (key.startsWith(`${orgId}/`)) this.files.delete(key);
    this.subscriptions.delete(orgId);
    for (const [id, i] of this.integrations) if (i.orgId === orgId) this.integrations.delete(id);
    this.outbound = this.outbound.filter((o) => o.orgId !== orgId);
    this.linkCodes = this.linkCodes.filter((l) => l.orgId !== orgId);
    this.notifications = this.notifications.filter((n) => n.orgId !== orgId);
    for (const [id, pb] of this.playbooks) if (pb.orgId === orgId) this.playbooks.delete(id);
  }

  async eraseUser(userId: string) {
    const p = this.profiles.get(userId);
    if (p) this.profiles.set(userId, { ...p, ...erasedProfile(userId) });
    this.memberships = this.memberships.filter((m) => m.userId !== userId);
    this.notifications = this.notifications.filter((n) => n.userId !== userId);
    this.linkCodes = this.linkCodes.filter((l) => l.userId !== userId);
    // Same rules as erase_person_from_history() in supabase/migrations/20261114000000_accounts.sql.
    const gone = 'Deleted user';
    this.events = this.events.map((e) => {
      const m = e.meta as Record<string, unknown> & { reassigned?: { from?: string; to?: string } };
      const meta = { ...m };
      if ('name' in m && (m.userId === userId || m.reassigned?.from === userId || (e.actorId === userId && e.type === 'member.joined'))) meta.name = gone;
      if ('toName' in m && (m.handedTo === userId || m.reassigned?.to === userId)) meta.toName = gone;
      if ('actorName' in m && e.actorId === userId) meta.actorName = gone;
      return { ...e, meta };
    });
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
  async listTasks(query: { orgId?: string; statuses?: TaskStatus[] }) {
    return [...this.tasks.values()]
      .filter((t) => (!query.orgId || t.orgId === query.orgId) && (!query.statuses || query.statuses.includes(t.status)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }
  async getTask(id: string) {
    const t = this.tasks.get(id);
    return t ? clone(t) : null;
  }
  async getTaskBySeq(orgId: string, seq: number) {
    const t = [...this.tasks.values()].find((x) => x.orgId === orgId && x.seq === seq);
    return t ? clone(t) : null;
  }
  async insertTask(input: NewTask & { createdAt?: string }) {
    const { occurrenceKey, createdAt, ...rest } = input;
    if (occurrenceKey) {
      if (this.occurrences.has(occurrenceKey)) throw new HttpError(409, 'Already created for this run', 'duplicate_occurrence');
      this.occurrences.add(occurrenceKey);
    }
    const seq = (this.taskSeq.get(rest.orgId) ?? 0) + 1;
    this.taskSeq.set(rest.orgId, seq);
    const ts = createdAt ?? now();
    const t: Task = { ...rest, id: uuid(), seq, createdAt: ts, updatedAt: ts };
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
    const e: LedgerEvent = Object.freeze({ ...input, id: String(this.eventSeq), createdAt: input.createdAt ?? now() }) as LedgerEvent;
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
  async createUploadUrl() {
    return null;
  }

  // Billing ------------------------------------------------------------------
  async getSubscription(orgId: string) {
    const s = this.subscriptions.get(orgId);
    return s ? clone(s) : null;
  }
  async listSubscriptions() {
    return [...this.subscriptions.values()].map(clone);
  }
  async upsertSubscription(sub: Subscription) {
    this.subscriptions.set(sub.orgId, clone(sub));
    return clone(sub);
  }
  async findSubscription(by: 'customer' | 'subscription', providerId: string) {
    const s = [...this.subscriptions.values()].find((x) => (by === 'customer' ? x.providerCustomerId : x.providerSubscriptionId) === providerId);
    return s ? clone(s) : null;
  }
  async recordWebhookEvent(provider: string, eventId: string) {
    const key = `${provider}:${eventId}`;
    if (this.webhookEvents.has(key)) return false;
    this.webhookEvents.add(key);
    return true;
  }

  // Integrations --------------------------------------------------------------
  async listIntegrations(orgId: string) {
    return [...this.integrations.values()].filter((i) => i.orgId === orgId).map(clone);
  }
  async getIntegration(id: string) {
    const i = this.integrations.get(id);
    return i ? clone(i) : null;
  }
  async getIntegrationFor(orgId: string, provider: IntegrationProvider) {
    const i = [...this.integrations.values()].find((x) => x.orgId === orgId && x.provider === provider);
    return i ? clone(i) : null;
  }
  async findIntegrationByConfig(provider: IntegrationProvider, key: string, value: string) {
    const i = [...this.integrations.values()].find((x) => x.provider === provider && String(x.config[key] ?? '') === value);
    return i ? clone(i) : null;
  }
  async saveIntegration(rec: Omit<IntegrationRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const existing = rec.id ? this.integrations.get(rec.id) : [...this.integrations.values()].find((x) => x.orgId === rec.orgId && x.provider === rec.provider);
    const saved: IntegrationRecord = {
      ...rec,
      id: existing?.id ?? uuid(),
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.integrations.set(saved.id, saved);
    return clone(saved);
  }
  async deleteIntegration(id: string) {
    this.integrations.delete(id);
  }
  async logOutbound(msg: Omit<OutboundMessage, 'id' | 'createdAt'>) {
    this.outbound.push({ ...msg, id: uuid(), createdAt: now() });
    if (this.outbound.length > 500) this.outbound.splice(0, this.outbound.length - 500);
  }
  async listOutbound(orgId: string, limit: number) {
    return this.outbound
      .filter((m) => m.orgId === orgId)
      .slice(-limit)
      .reverse()
      .map(clone);
  }

  // Phone linking ---------------------------------------------------------------
  async createLinkCode(input: { code: string; userId: string; orgId: string; expiresAt: string }) {
    this.linkCodes = this.linkCodes.filter((c) => c.userId !== input.userId);
    this.linkCodes.push({ ...input, usedAt: null });
  }
  async getActiveLinkCode(userId: string) {
    const c = this.linkCodes.find((x) => x.userId === userId && !x.usedAt && x.expiresAt > now());
    return c ? { code: c.code, expiresAt: c.expiresAt } : null;
  }
  async consumeLinkCode(code: string) {
    const c = this.linkCodes.find((x) => x.code === code.toUpperCase() && !x.usedAt && x.expiresAt > now());
    if (!c) return null;
    c.usedAt = now();
    return { userId: c.userId, orgId: c.orgId };
  }

  // Notifications -----------------------------------------------------------------
  async insertNotifications(list: Array<Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>>) {
    for (const n of list) this.notifications.push({ ...n, id: uuid(), createdAt: now(), readAt: null });
  }
  async listNotifications(userId: string, limit: number, scope: 'all' | 'general' = 'all') {
    return this.notifications
      .filter((n) => n.userId === userId && (scope === 'all' || !n.taskId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }
  async listUnreadNotifications(userId: string) {
    return this.notifications
      .filter((n) => n.userId === userId && !n.readAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 500)
      .map(clone);
  }
  async markNotificationsRead(userId: string, ids: string[] | 'all' | { taskId: string }) {
    const ts = now();
    for (const n of this.notifications) {
      if (n.userId !== userId || n.readAt) continue;
      const hit = ids === 'all' ? !n.taskId : Array.isArray(ids) ? ids.includes(n.id) : n.taskId === ids.taskId;
      if (hit) n.readAt = ts;
    }
  }

  // Playbooks -----------------------------------------------------------------------
  async listPlaybooks(orgId?: string) {
    return [...this.playbooks.values()]
      .filter((p) => !orgId || p.orgId === orgId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
  async getPlaybook(id: string) {
    const p = this.playbooks.get(id);
    return p ? clone(p) : null;
  }
  async savePlaybook(p: Omit<Playbook, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const existing = p.id ? this.playbooks.get(p.id) : undefined;
    const saved: Playbook = { ...p, id: existing?.id ?? uuid(), createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    this.playbooks.set(saved.id, saved);
    return clone(saved);
  }
  async deletePlaybook(id: string) {
    this.playbooks.delete(id);
  }
}

export const defaultSettings = () => clone(DEFAULT_ORG_SETTINGS);
