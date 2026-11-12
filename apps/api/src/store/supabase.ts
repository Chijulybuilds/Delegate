import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
import { HttpError, notFound } from '../lib/errors.js';
import type { MembershipRecord, NewTask, Store, TaskPatch } from './types.js';

type Row = Record<string, unknown>;

const toCamelKey = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toSnakeKey = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function camel<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[toCamelKey(k)] = v;
  return out as T;
}
function snake(obj: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[toSnakeKey(k)] = v;
  return out;
}

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, context: string): T {
  if (result.error) {
    console.error(`[supabase] ${context}:`, result.error);
    if (result.error.code === '23505') throw new HttpError(409, 'That record already exists', 'conflict');
    throw new HttpError(500, `Database error while ${context}`, 'db_error');
  }
  return result.data;
}

function rows(result: { data: Row[] | null; error: { message: string; code?: string } | null }, context: string): Row[] {
  return check(result, context) ?? [];
}

/** Production store backed by Supabase Postgres + Storage (service-role client, server-side only). */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private bucket: string,
  ) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // Profiles ---------------------------------------------------------------
  async getProfile(id: string) {
    const data = check(await this.db.from('profiles').select('*').eq('id', id).maybeSingle(), 'loading profile');
    return data ? camel<Profile>(data) : null;
  }
  async getProfileByEmail(email: string) {
    const data = check(
      await this.db.from('profiles').select('*').ilike('email', email).limit(1).maybeSingle(),
      'loading profile by email',
    );
    return data ? camel<Profile>(data) : null;
  }
  async upsertProfile(input: { id: string; email: string; fullName: string; avatarUrl: string | null }) {
    const data = check(
      await this.db.from('profiles').upsert(snake(input), { onConflict: 'id' }).select('*').single(),
      'saving profile',
    );
    return camel<Profile>(data);
  }
  async listProfiles() {
    const data = rows(await this.db.from('profiles').select('*').order('created_at', { ascending: false }), 'listing profiles');
    return data.map((r) => camel<Profile>(r));
  }
  async setProfileStatus(id: string, status: Profile['status']) {
    check(await this.db.from('profiles').update({ status }).eq('id', id), 'updating profile status');
  }

  // Organizations ----------------------------------------------------------
  async createOrg(input: Pick<Organization, 'name' | 'slug' | 'inviteCode' | 'timezone'>) {
    const data = check(await this.db.from('organizations').insert(snake(input)).select('*').single(), 'creating workspace');
    return camel<Organization>(data);
  }
  async getOrg(id: string) {
    const data = check(await this.db.from('organizations').select('*').eq('id', id).maybeSingle(), 'loading workspace');
    return data ? camel<Organization>(data) : null;
  }
  async getOrgByInviteCode(code: string) {
    const data = check(
      await this.db.from('organizations').select('*').eq('invite_code', code.toUpperCase()).maybeSingle(),
      'loading workspace by invite',
    );
    return data ? camel<Organization>(data) : null;
  }
  async slugExists(slug: string) {
    const { count, error } = await this.db.from('organizations').select('id', { count: 'exact', head: true }).eq('slug', slug);
    if (error) throw new HttpError(500, 'Database error while checking slug', 'db_error');
    return (count ?? 0) > 0;
  }
  async listOrgs() {
    const data = rows(await this.db.from('organizations').select('*').order('created_at', { ascending: false }), 'listing workspaces');
    return data.map((r) => camel<Organization>(r));
  }
  async updateOrg(id: string, patch: Partial<Pick<Organization, 'name' | 'status' | 'plan' | 'inviteCode' | 'timezone'>>) {
    const data = check(
      await this.db.from('organizations').update(snake(patch)).eq('id', id).select('*').maybeSingle(),
      'updating workspace',
    );
    if (!data) throw notFound('Workspace not found');
    return camel<Organization>(data);
  }

  // Memberships ------------------------------------------------------------
  async getMembershipForUser(userId: string) {
    const data = check(
      await this.db.from('memberships').select('*').eq('user_id', userId).order('joined_at').limit(1).maybeSingle(),
      'loading membership',
    );
    return data ? camel<MembershipRecord>(data) : null;
  }
  async listMemberships(orgId?: string) {
    let q = this.db.from('memberships').select('*');
    if (orgId) q = q.eq('org_id', orgId);
    const data = rows(await q, 'listing memberships');
    return data.map((r) => camel<MembershipRecord>(r));
  }
  async listMembers(orgId: string): Promise<Member[]> {
    const data = rows(
      await this.db
        .from('memberships')
        .select('org_id, user_id, role, department_id, joined_at, profile:profiles(full_name, email, avatar_url)')
        .eq('org_id', orgId)
        .order('joined_at'),
      'listing members',
    );
    return (data as unknown as Array<Row & { profile: Row | null }>).map((r) => ({
      userId: r.user_id as string,
      orgId: r.org_id as string,
      role: r.role as Member['role'],
      departmentId: (r.department_id as string | null) ?? null,
      joinedAt: r.joined_at as string,
      fullName: (r.profile?.full_name as string) ?? 'Unknown',
      email: (r.profile?.email as string) ?? '',
      avatarUrl: (r.profile?.avatar_url as string | null) ?? null,
    }));
  }
  async addMember(input: Omit<MembershipRecord, 'joinedAt'>) {
    check(await this.db.from('memberships').upsert(snake(input), { onConflict: 'org_id,user_id', ignoreDuplicates: true }), 'adding member');
  }
  async updateMember(orgId: string, userId: string, patch: Partial<Pick<MembershipRecord, 'role' | 'departmentId'>>) {
    check(await this.db.from('memberships').update(snake(patch)).eq('org_id', orgId).eq('user_id', userId), 'updating member');
  }

  // Departments --------------------------------------------------------------
  async listDepartments(orgId: string) {
    const data = rows(await this.db.from('departments').select('*').eq('org_id', orgId).order('name'), 'listing departments');
    return data.map((r) => camel<Department>(r));
  }
  async createDepartment(input: Pick<Department, 'orgId' | 'name' | 'color'>) {
    const data = check(await this.db.from('departments').insert(snake(input)).select('*').single(), 'creating department');
    return camel<Department>(data);
  }

  // Tasks ------------------------------------------------------------------
  async listTasks(query: { orgId?: string }) {
    let q = this.db.from('tasks').select('*').order('created_at', { ascending: false }).limit(5000);
    if (query.orgId) q = q.eq('org_id', query.orgId);
    const data = rows(await q, 'listing tasks');
    return data.map((r) => camel<Task>(r));
  }
  async getTask(id: string) {
    const data = check(await this.db.from('tasks').select('*').eq('id', id).maybeSingle(), 'loading task');
    return data ? camel<Task>(data) : null;
  }
  async insertTask(input: NewTask) {
    const data = check(await this.db.from('tasks').insert(snake({ ...input })).select('*').single(), 'creating task');
    return camel<Task>(data);
  }
  async updateTask(id: string, patch: TaskPatch) {
    const data = check(
      await this.db
        .from('tasks')
        .update(snake({ ...patch, updatedAt: new Date().toISOString() }))
        .eq('id', id)
        .select('*')
        .maybeSingle(),
      'updating task',
    );
    if (!data) throw notFound('Task not found');
    return camel<Task>(data);
  }
  async countTasksByStatus(orgId?: string) {
    const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    await Promise.all(
      TASK_STATUSES.map(async (status) => {
        let q = this.db.from('tasks').select('id', { count: 'exact', head: true }).eq('status', status);
        if (orgId) q = q.eq('org_id', orgId);
        const { count, error } = await q;
        if (error) throw new HttpError(500, 'Database error while counting tasks', 'db_error');
        counts[status] = count ?? 0;
      }),
    );
    return counts;
  }
  async orgStats() {
    const data = rows(await this.db.from('admin_org_stats').select('*'), 'loading workspace stats');
    return data.map((r) => ({
      orgId: r.org_id as string,
      members: Number(r.members ?? 0),
      tasks: Number(r.tasks ?? 0),
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
    }));
  }

  // Proofs & comments --------------------------------------------------------
  async listProofs(taskId: string) {
    const data = rows(await this.db.from('task_proofs').select('*').eq('task_id', taskId).order('created_at'), 'listing proofs');
    return data.map((r) => camel<TaskProof>(r));
  }
  async listProofsForOrg(orgId: string) {
    const data = rows(await this.db.from('task_proofs').select('*').eq('org_id', orgId), 'listing proofs');
    return data.map((r) => camel<TaskProof>(r));
  }
  async insertProof(input: Omit<TaskProof, 'id' | 'createdAt'>) {
    const data = check(await this.db.from('task_proofs').insert(snake(input)).select('*').single(), 'saving proof');
    return camel<TaskProof>(data);
  }
  async listComments(taskId: string) {
    const data = rows(await this.db.from('task_comments').select('*').eq('task_id', taskId).order('created_at'), 'listing comments');
    return data.map((r) => camel<TaskComment>(r));
  }
  async insertComment(input: Omit<TaskComment, 'id' | 'createdAt'>) {
    const data = check(await this.db.from('task_comments').insert(snake(input)).select('*').single(), 'saving comment');
    return camel<TaskComment>(data);
  }

  // Ledger -----------------------------------------------------------------
  async appendEvent(input: Omit<LedgerEvent, 'id' | 'createdAt'>) {
    const data = check(await this.db.from('task_events').insert(snake(input)).select('*').single(), 'writing ledger event');
    return { ...camel<LedgerEvent>(data), id: String(data.id) };
  }
  async listEvents(query: { orgId?: string; taskId?: string; before?: string; limit: number }) {
    let q = this.db.from('task_events').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit);
    if (query.orgId) q = q.eq('org_id', query.orgId);
    if (query.taskId) q = q.eq('task_id', query.taskId);
    if (query.before) q = q.lt('created_at', query.before);
    const data = rows(await q, 'listing ledger');
    return data.map((r) => ({ ...camel<LedgerEvent>(r), id: String(r.id) }));
  }
  async countEventsSince(iso: string) {
    const { count, error } = await this.db.from('task_events').select('id', { count: 'exact', head: true }).gte('created_at', iso);
    if (error) throw new HttpError(500, 'Database error while counting events', 'db_error');
    return count ?? 0;
  }

  // Files ------------------------------------------------------------------
  async putFile(path: string, data: Buffer, contentType: string) {
    const { error } = await this.db.storage.from(this.bucket).upload(path, data, { contentType, upsert: false });
    if (error) {
      console.error('[supabase] upload failed', error);
      throw new HttpError(500, 'Could not store the file', 'storage_error');
    }
  }
  async getFile(path: string) {
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUrl(path, 60);
    if (error || !data) return null;
    return { url: data.signedUrl };
  }
}
