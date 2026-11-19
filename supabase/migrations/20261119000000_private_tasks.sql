-- Delegate · private tasks and owner-only invite codes (run after 20261114000000_accounts.sql).
-- Safe to run more than once.
--
-- The workspace owner sees every task. Everyone else sees only the work that involves them:
-- tasks assigned to them, tasks they handed out, and a task that's blocked waiting on them.
-- The API applies the same rule; these policies make sure nobody can read around it with the
-- browser's own Supabase session (the REST API or the realtime feed).

-- Is the signed-in person the owner of this workspace?
create or replace function public.is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

-- Can the signed-in person see this task? (Security definer: it reads tasks/memberships itself,
-- so policies on other tables can call it without recursion.)
create or replace function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tasks t
    join public.memberships m on m.org_id = t.org_id and m.user_id = (select auth.uid())
    where t.id = p_task
      and (m.role = 'owner' or t.assignee_id = m.user_id or t.created_by_id = m.user_id or t.waiting_on_id = m.user_id)
  );
$$;

revoke execute on function public.is_org_owner(uuid) from public, anon;
revoke execute on function public.can_see_task(uuid) from public, anon;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;
grant execute on function public.can_see_task(uuid) to authenticated, service_role;

drop policy if exists "tasks: members read" on public.tasks;
drop policy if exists "tasks: owner or involved" on public.tasks;
create policy "tasks: owner or involved" on public.tasks for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.org_id = tasks.org_id and m.user_id = (select auth.uid())
        and (m.role = 'owner' or tasks.assignee_id = m.user_id or tasks.created_by_id = m.user_id or tasks.waiting_on_id = m.user_id)
    )
  );

drop policy if exists "task_proofs: members read" on public.task_proofs;
drop policy if exists "task_proofs: visible tasks" on public.task_proofs;
create policy "task_proofs: visible tasks" on public.task_proofs for select to authenticated
  using (public.can_see_task(task_id));

drop policy if exists "task_comments: members read" on public.task_comments;
drop policy if exists "task_comments: visible tasks" on public.task_comments;
create policy "task_comments: visible tasks" on public.task_comments for select to authenticated
  using (public.can_see_task(task_id));

-- History: events on tasks you can see; workspace-level events for the owner, or your own.
drop policy if exists "task_events: members read" on public.task_events;
drop policy if exists "task_events: visible tasks" on public.task_events;
create policy "task_events: visible tasks" on public.task_events for select to authenticated
  using (
    case
      when task_id is not null then public.can_see_task(task_id)
      else public.is_org_owner(org_id) or (actor_id = (select auth.uid()) and public.is_org_member(org_id))
    end
  );

-- ── Invite codes: the owner's alone ─────────────────────────────────────────────────────────
-- Only the owner brings people in. Browsers may read their workspace's name and settings, but not
-- its invite code; the owner gets the code through the API.
revoke select on public.organizations from authenticated;
grant select (id, name, slug, plan, status, timezone, created_at, settings, task_seq) on public.organizations to authenticated;

-- Lets the API check that this file has run: browsers must not be able to read invite codes.
create or replace function public.invite_codes_readable_by_browsers() returns boolean
language sql stable security definer set search_path = '' as $$
  select has_column_privilege('authenticated', 'public.organizations', 'invite_code', 'SELECT');
$$;
revoke execute on function public.invite_codes_readable_by_browsers() from public, anon, authenticated;
grant execute on function public.invite_codes_readable_by_browsers() to service_role;
