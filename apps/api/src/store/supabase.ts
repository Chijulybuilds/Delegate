import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  TASK_STATUSES,
  withDefaultSettings,
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
import { erasedProfile } from './types.js';
import type { IntegrationRecord, MembershipRecord, NewTask, Store, TaskPatch } from './types.js';

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;

const toCamelKey = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toSnakeKey = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Top-level keys only: JSON columns (settings, config, items, meta) keep their own casing. */
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

function check<T>(result: { data: T; error: DbError }, context: string): T {
  if (result.error) {
    console.error(`[supabase] ${context}:`, result.error);
    if (result.error.code === '23505') throw new HttpError(409, 'That record already exists', 'conflict');
    throw new HttpError(500, `Database error while ${context}`, 'db_error');
  }
  return result.data;
}

/** For `.single()` inserts/updates: error → HttpError, and a guaranteed row. */
function one(result: { data: Row | null; error: DbError }, context: string): Row {
  const data = check(result, context);
  if (!data) throw new HttpError(500, `Database returned nothing while ${context}`, 'db_error');
  return data;
}

function rows(result: { data: Row[] | null; error: DbError }, context: string): Row[] {
  return check(result, context) ?? [];
}

const toOrg = (r: Row) => {
  const o = camel<Organization & { taskSeq?: number }>(r);
  delete o.taskSeq;
  return { ...o, settings: withDefaultSettings(o.settings) } as Organization;
};
const toTask = (r: Row) => {
  const t = camel<Task & { occurrenceKey?: string }>(r);
  delete t.occurrenceKey;
  return t as Task;
};
const toEvent = (r: Row): LedgerEvent => ({ ...camel<LedgerEvent>(r), id: String(r.id) });

/** Production store backed by Supabase Postgres + Storage (service-role client, server-side only). */

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  /** A client with only the public (publishable) key: used to check what browsers are allowed to do. */
  private publicDb: SupabaseClient | null;

  constructor(
    url: string,
    serviceRoleKey: string,
    private bucket: string,
    anonKey?: string,
  ) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    this.publicDb = anonKey ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }

  // Schema -----------------------------------------------------------------
  /** One cheap probe per migration, so a half-migrated database is named instead of failing as a 500. */
  async checkSchema(): Promise<string | null> {
    const missing = async (table: string, columns: string) => {
      const { error } = await this.db.from(table).select(columns).limit(1);
      if (!error) return false;
      // 42P01 / PGRST205: table doesn't exist · 42703 / PGRST204: column doesn't exist
      if (['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '')) return true;
      if (/does not exist|could not find/i.test(error.message)) return true;
      throw new Error(`Supabase check failed: ${error.message}`);
    };
    try {
      if (await missing('profiles', 'id')) {
        return 'The Supabase database is empty: run every file in supabase/migrations (Supabase → SQL Editor), oldest first.';
      }
      const saas = await Promise.all([
        missing('profiles', 'id, phone'),
        missing('organizations', 'id, settings, task_seq'),
        missing('tasks', 'id, seq, source, escalation_level'),
        missing('subscriptions', 'org_id'),
        missing('playbooks', 'id'),
        missing('notifications', 'id'),
      ]);
      if (saas.some(Boolean)) {
        return 'The Supabase database is missing the latest migration: open Supabase → SQL Editor and run supabase/migrations/20261113000000_saas.sql.';
      }
      const ACCOUNTS = 'supabase/migrations/20261114000000_accounts.sql';
      // Needed for "Delete account". Probing with a nil id changes nothing.
      const erase = await this.db.rpc('erase_person_from_history', { p_user: NIL_UUID });
      if (erase.error && (['PGRST202', '42883'].includes(erase.error.code ?? '') || /could not find the function|does not exist/i.test(erase.error.message))) {
        return `The Supabase database is missing the latest migration: open Supabase → SQL Editor and run ${ACCOUNTS}.`;
      }
      // Private tasks: row-level security that hides other people's tasks from browsers.
      const PRIVATE = 'supabase/migrations/20261119000000_private_tasks.sql';
      const priv = await this.db.rpc('can_see_task', { p_task: NIL_UUID });
      if (priv.error && (['PGRST202', '42883'].includes(priv.error.code ?? '') || /could not find the function|does not exist/i.test(priv.error.message))) {
        return `Database update needed: open Supabase → SQL Editor and run ${PRIVATE} (it keeps each person's tasks private).`;
      }
      // Security: browsers must not be able to purge a workspace. Probing with a nil id deletes nothing.
      if (this.publicDb) {
        const { error } = await this.publicDb.rpc('purge_organization', { p_org: NIL_UUID });
        if (!error) return `Security update needed: open Supabase → SQL Editor and run ${ACCOUNTS} (it stops browsers from calling the workspace-delete function).`;
      }
      return null;
    } catch (error) {
      return error instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|Invalid API key|JWT/i.test(error.message)
        ? `Can't reach Supabase with the configured SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (${error.message}).`
        : null;
    }
  }

  // Profiles ---------------------------------------------------------------
  async getProfile(id: string) {
    const data = check(await this.db.from('profiles').select('*').eq('id', id).maybeSingle(), 'loading profile');
    return data ? camel<Profile>(data) : null;
  }
  async getProfileByEmail(email: string) {
    const data = check(await this.db.from('profiles').select('*').ilike('email', email).limit(1).maybeSingle(), 'loading profile by email');
    return data ? camel<Profile>(data) : null;
  }
  async getProfileByPhone(phone: string) {
    const data = check(await this.db.from('profiles').select('*').eq('phone', phone).limit(1).maybeSingle(), 'loading profile by phone');
    return data ? camel<Profile>(data) : null;
  }
  async upsertProfile(input: { id: string; email: string; fullName: string; avatarUrl: string | null }) {
    const data = check(await this.db.from('profiles').upsert(snake(input), { onConflict: 'id' }).select('*').single(), 'saving profile');
    return camel<Profile>(data);
  }
  async listProfiles() {
    return rows(await this.db.from('profiles').select('*').order('created_at', { ascending: false }), 'listing profiles').map((r) => camel<Profile>(r));
  }
  async setProfileStatus(id: string, status: Profile['status']) {
    check(await this.db.from('profiles').update({ status }).eq('id', id), 'updating profile status');
  }
  async setProfilePhone(id: string, phone: string | null) {
    if (phone) check(await this.db.from('profiles').update({ phone: null }).eq('phone', phone).neq('id', id), 'releasing phone');
    check(await this.db.from('profiles').update({ phone }).eq('id', id), 'saving phone');
  }

  // Organizations ----------------------------------------------------------
  async createOrg(input: Pick<Organization, 'name' | 'slug' | 'inviteCode' | 'timezone' | 'settings'>) {
    return toOrg(one(await this.db.from('organizations').insert(snake(input)).select('*').single(), 'creating workspace'));
  }
  async getOrg(id: string) {
    const data = check(await this.db.from('organizations').select('*').eq('id', id).maybeSingle(), 'loading workspace');
    return data ? toOrg(data) : null;
  }
  async getOrgByInviteCode(code: string) {
    const data = check(await this.db.from('organizations').select('*').eq('invite_code', code.toUpperCase()).maybeSingle(), 'loading workspace by invite');
    return data ? toOrg(data) : null;
  }
  async slugExists(slug: string) {
    const { count, error } = await this.db.from('organizations').select('id', { count: 'exact', head: true }).eq('slug', slug);
    if (error) throw new HttpError(500, 'Database error while checking slug', 'db_error');
    return (count ?? 0) > 0;
  }
  async listOrgs() {
    return rows(await this.db.from('organizations').select('*').order('created_at', { ascending: false }), 'listing workspaces').map(toOrg);
  }
  async updateOrg(id: string, patch: Partial<Pick<Organization, 'name' | 'status' | 'plan' | 'inviteCode' | 'timezone' | 'settings'>>) {
    const data = check(await this.db.from('organizations').update(snake(patch)).eq('id', id).select('*').maybeSingle(), 'updating workspace');
    if (!data) throw notFound('Workspace not found');
    return toOrg(data);
  }

  // Memberships ------------------------------------------------------------
  async getMembershipForUser(userId: string) {
    const data = check(await this.db.from('memberships').select('*').eq('user_id', userId).order('joined_at').limit(1).maybeSingle(), 'loading membership');
    return data ? camel<MembershipRecord>(data) : null;
  }
  async listMemberships(orgId?: string) {
    let q = this.db.from('memberships').select('*');
    if (orgId) q = q.eq('org_id', orgId);
    return rows(await q, 'listing memberships').map((r) => camel<MembershipRecord>(r));
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
    return (data as Array<Row & { profile: Row | null }>).map((r) => ({
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
  async removeMember(orgId: string, userId: string) {
    check(await this.db.from('memberships').delete().eq('org_id', orgId).eq('user_id', userId), 'removing member');
  }

  async deleteOrg(orgId: string) {
    // Files first (best effort): proofs live under "<orgId>/<taskId>/<file>".
    try {
      const bucket = this.db.storage.from(this.bucket);
      const { data: folders } = await bucket.list(orgId, { limit: 1000 });
      const paths: string[] = [];
      for (const f of folders ?? []) {
        if (f.id) paths.push(`${orgId}/${f.name}`);
        else for (const file of (await bucket.list(`${orgId}/${f.name}`, { limit: 1000 })).data ?? []) paths.push(`${orgId}/${f.name}/${file.name}`);
      }
      for (let i = 0; i < paths.length; i += 100) await bucket.remove(paths.slice(i, i + 100));
    } catch (error) {
      console.error('[supabase] could not remove workspace files', error);
    }
    // purge_organization lifts the ledger's append-only guard for this one deletion.
    const { error } = await this.db.rpc('purge_organization', { p_org: orgId });
    if (error) {
      console.error('[supabase] purge_organization failed', error);
      throw new HttpError(500, 'Could not delete the workspace', 'db_error');
    }
  }

  async eraseUser(userId: string) {
    check(await this.db.from('memberships').delete().eq('user_id', userId), 'removing memberships');
    check(await this.db.from('notifications').delete().eq('user_id', userId), 'removing notifications');
    check(await this.db.from('link_codes').delete().eq('user_id', userId), 'removing WhatsApp link codes');
    check(await this.db.rpc('erase_person_from_history', { p_user: userId }), 'erasing their name from the activity history');
    check(await this.db.from('profiles').update(snake(erasedProfile(userId))).eq('id', userId), 'erasing profile');
    // Soft delete: the sign-in is gone (email and Google link removed), while the profile row stays so
    // tasks and the activity history keep pointing at "Deleted user".
    const { error } = await this.db.auth.admin.deleteUser(userId, true);
    if (error && !/not.?found/i.test(error.message)) {
      console.error('[supabase] could not delete auth user', error);
      throw new HttpError(500, 'Could not delete the sign-in for this account', 'auth_error');
    }
  }

  async updateMember(orgId: string, userId: string, patch: Partial<Pick<MembershipRecord, 'role' | 'departmentId'>>) {
    check(await this.db.from('memberships').update(snake(patch)).eq('org_id', orgId).eq('user_id', userId), 'updating member');
  }

  // Departments --------------------------------------------------------------
  async listDepartments(orgId: string) {
    return rows(await this.db.from('departments').select('*').eq('org_id', orgId).order('name'), 'listing departments').map((r) => camel<Department>(r));
  }
  async createDepartment(input: Pick<Department, 'orgId' | 'name' | 'color'>) {
    return camel<Department>(one(await this.db.from('departments').insert(snake(input)).select('*').single(), 'creating department'));
  }

  // Tasks ------------------------------------------------------------------
  async listTasks(query: { orgId?: string; statuses?: TaskStatus[] }) {
    let q = this.db.from('tasks').select('*').order('created_at', { ascending: false }).limit(5000);
    if (query.orgId) q = q.eq('org_id', query.orgId);
    if (query.statuses) q = q.in('status', query.statuses);
    return rows(await q, 'listing tasks').map(toTask);
  }
  async getTask(id: string) {
    const data = check(await this.db.from('tasks').select('*').eq('id', id).maybeSingle(), 'loading task');
    return data ? toTask(data) : null;
  }
  async getTaskBySeq(orgId: string, seq: number) {
    const data = check(await this.db.from('tasks').select('*').eq('org_id', orgId).eq('seq', seq).maybeSingle(), 'loading task by reference');
    return data ? toTask(data) : null;
  }
  async insertTask(input: NewTask) {
    // `seq` is assigned by the tasks_assign_seq trigger (per-workspace counter).
    const res = await this.db.from('tasks').insert(snake({ ...input })).select('*').single();
    if (res.error?.code === '23505' && input.occurrenceKey) throw new HttpError(409, 'Already created for this run', 'duplicate_occurrence');
    return toTask(one(res, 'creating task'));
  }
  async updateTask(id: string, patch: TaskPatch) {
    const data = check(
      await this.db.from('tasks').update(snake({ ...patch, updatedAt: new Date().toISOString() })).eq('id', id).select('*').maybeSingle(),
      'updating task',
    );
    if (!data) throw notFound('Task not found');
    return toTask(data);
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
    return rows(await this.db.from('admin_org_stats').select('*'), 'loading workspace stats').map((r) => ({
      orgId: r.org_id as string,
      members: Number(r.members ?? 0),
      tasks: Number(r.tasks ?? 0),
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
    }));
  }

  // Proofs & comments --------------------------------------------------------
  async listProofs(taskId: string) {
    return rows(await this.db.from('task_proofs').select('*').eq('task_id', taskId).order('created_at'), 'listing proofs').map((r) => camel<TaskProof>(r));
  }
  async listProofsForOrg(orgId: string) {
    return rows(await this.db.from('task_proofs').select('*').eq('org_id', orgId), 'listing proofs').map((r) => camel<TaskProof>(r));
  }
  async insertProof(input: Omit<TaskProof, 'id' | 'createdAt'>) {
    return camel<TaskProof>(one(await this.db.from('task_proofs').insert(snake(input)).select('*').single(), 'saving proof'));
  }
  async listComments(taskId: string) {
    return rows(await this.db.from('task_comments').select('*').eq('task_id', taskId).order('created_at'), 'listing comments').map((r) => camel<TaskComment>(r));
  }
  async insertComment(input: Omit<TaskComment, 'id' | 'createdAt'>) {
    return camel<TaskComment>(one(await this.db.from('task_comments').insert(snake(input)).select('*').single(), 'saving comment'));
  }

  // Ledger -----------------------------------------------------------------
  async appendEvent(input: Omit<LedgerEvent, 'id' | 'createdAt'>) {
    return toEvent(one(await this.db.from('task_events').insert(snake(input)).select('*').single(), 'writing ledger event'));
  }
  async listEvents(query: { orgId?: string; taskId?: string; before?: string; limit: number }) {
    let q = this.db.from('task_events').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit);
    if (query.orgId) q = q.eq('org_id', query.orgId);
    if (query.taskId) q = q.eq('task_id', query.taskId);
    if (query.before) q = q.lt('created_at', query.before);
    return rows(await q, 'listing ledger').map(toEvent);
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
  async createUploadUrl(path: string) {
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[supabase] signed upload url failed', error);
      throw new HttpError(500, 'Could not prepare the upload', 'storage_error');
    }
    return { signedUrl: data.signedUrl, token: data.token, bucket: this.bucket };
  }

  // Billing ------------------------------------------------------------------
  async getSubscription(orgId: string) {
    const data = check(await this.db.from('subscriptions').select('*').eq('org_id', orgId).maybeSingle(), 'loading subscription');
    return data ? camel<Subscription>(data) : null;
  }
  async listSubscriptions() {
    return rows(await this.db.from('subscriptions').select('*'), 'listing subscriptions').map((r) => camel<Subscription>(r));
  }
  async upsertSubscription(sub: Subscription) {
    return camel<Subscription>(one(await this.db.from('subscriptions').upsert(snake({ ...sub }), { onConflict: 'org_id' }).select('*').single(), 'saving subscription'));
  }
  async findSubscription(by: 'customer' | 'subscription', providerId: string) {
    const column = by === 'customer' ? 'provider_customer_id' : 'provider_subscription_id';
    const data = check(await this.db.from('subscriptions').select('*').eq(column, providerId).limit(1).maybeSingle(), 'finding subscription');
    return data ? camel<Subscription>(data) : null;
  }
  async recordWebhookEvent(provider: string, eventId: string) {
    const { error } = await this.db.from('webhook_events').insert({ provider, event_id: eventId });
    if (!error) return true;
    if (error.code === '23505') return false;
    console.error('[supabase] webhook dedupe failed', error);
    throw new HttpError(500, 'Database error while recording webhook', 'db_error');
  }

  // Integrations --------------------------------------------------------------
  async listIntegrations(orgId: string) {
    return rows(await this.db.from('integrations').select('*').eq('org_id', orgId), 'listing integrations').map((r) => camel<IntegrationRecord>(r));
  }
  async getIntegration(id: string) {
    const data = check(await this.db.from('integrations').select('*').eq('id', id).maybeSingle(), 'loading integration');
    return data ? camel<IntegrationRecord>(data) : null;
  }
  async getIntegrationFor(orgId: string, provider: IntegrationProvider) {
    const data = check(await this.db.from('integrations').select('*').eq('org_id', orgId).eq('provider', provider).maybeSingle(), 'loading integration');
    return data ? camel<IntegrationRecord>(data) : null;
  }
  async findIntegrationByConfig(provider: IntegrationProvider, key: string, value: string) {
    if (!/^[a-zA-Z]+$/.test(key)) throw new HttpError(500, 'Invalid integration lookup', 'bad_lookup');
    const data = check(
      await this.db.from('integrations').select('*').eq('provider', provider).eq(`config->>${key}`, value).limit(1).maybeSingle(),
      'finding integration',
    );
    return data ? camel<IntegrationRecord>(data) : null;
  }
  async saveIntegration(rec: Omit<IntegrationRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const payload = snake({ ...rec, updatedAt: new Date().toISOString() });
    const data = check(await this.db.from('integrations').upsert(payload, { onConflict: 'org_id,provider' }).select('*').single(), 'saving integration');
    return camel<IntegrationRecord>(data);
  }
  async deleteIntegration(id: string) {
    check(await this.db.from('integrations').delete().eq('id', id), 'removing integration');
  }
  async logOutbound(msg: Omit<OutboundMessage, 'id' | 'createdAt'>) {
    const { error } = await this.db.from('outbound_messages').insert(snake({ ...msg }));
    if (error) console.error('[supabase] could not log outbound message', error);
  }
  async listOutbound(orgId: string, limit: number) {
    return rows(
      await this.db.from('outbound_messages').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit),
      'listing deliveries',
    ).map((r) => camel<OutboundMessage>(r));
  }

  // Phone linking ---------------------------------------------------------------
  async createLinkCode(input: { code: string; userId: string; orgId: string; expiresAt: string }) {
    check(await this.db.from('link_codes').delete().eq('user_id', input.userId), 'clearing link codes');
    check(await this.db.from('link_codes').insert(snake(input)), 'creating link code');
  }
  async getActiveLinkCode(userId: string) {
    const data = check(
      await this.db.from('link_codes').select('code, expires_at').eq('user_id', userId).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle(),
      'loading link code',
    );
    return data ? { code: data.code as string, expiresAt: data.expires_at as string } : null;
  }
  async consumeLinkCode(code: string) {
    const data = check(
      await this.db
        .from('link_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('code', code.toUpperCase())
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .select('user_id, org_id')
        .maybeSingle(),
      'using link code',
    );
    return data ? { userId: data.user_id as string, orgId: data.org_id as string } : null;
  }

  // Notifications -----------------------------------------------------------------
  async insertNotifications(list: Array<Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>>) {
    if (!list.length) return;
    check(await this.db.from('notifications').insert(list.map((n) => snake({ ...n }))), 'saving notifications');
  }
  async listNotifications(userId: string, limit: number, scope: 'all' | 'general' = 'all') {
    let q = this.db.from('notifications').select('*').eq('user_id', userId);
    if (scope === 'general') q = q.is('task_id', null);
    return rows(await q.order('created_at', { ascending: false }).limit(limit), 'listing notifications').map((r) => camel<AppNotification>(r));
  }
  async listUnreadNotifications(userId: string) {
    return rows(
      await this.db.from('notifications').select('*').eq('user_id', userId).is('read_at', null).order('created_at', { ascending: false }).limit(500),
      'listing unread notifications',
    ).map((r) => camel<AppNotification>(r));
  }
  async markNotificationsRead(userId: string, ids: string[] | 'all' | { taskId: string }) {
    let q = this.db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
    if (ids === 'all') q = q.is('task_id', null);
    else if (Array.isArray(ids)) q = q.in('id', ids);
    else q = q.eq('task_id', ids.taskId);
    check(await q, 'marking notifications read');
  }

  // Playbooks -----------------------------------------------------------------------
  async listPlaybooks(orgId?: string) {
    let q = this.db.from('playbooks').select('*').order('created_at');
    if (orgId) q = q.eq('org_id', orgId);
    return rows(await q, 'listing playbooks').map((r) => camel<Playbook>(r));
  }
  async getPlaybook(id: string) {
    const data = check(await this.db.from('playbooks').select('*').eq('id', id).maybeSingle(), 'loading playbook');
    return data ? camel<Playbook>(data) : null;
  }
  async savePlaybook(p: Omit<Playbook, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const payload = snake({ ...p, updatedAt: new Date().toISOString() });
    const q = p.id ? this.db.from('playbooks').update(payload).eq('id', p.id) : this.db.from('playbooks').insert(payload);
    return camel<Playbook>(one(await q.select('*').single(), 'saving playbook'));
  }
  async deletePlaybook(id: string) {
    check(await this.db.from('playbooks').delete().eq('id', id), 'removing playbook');
  }
}
