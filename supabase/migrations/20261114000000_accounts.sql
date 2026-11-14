-- Delegate · account deletion + security hardening (run after 20261113000000_saas.sql)
-- Safe to run more than once.

-- ── 1. Security ───────────────────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on functions in the public schema to the browser roles (anon,
-- authenticated) by default. Revoking from PUBLIC alone therefore left purge_organization()
-- callable through the API with the public key. Only the server (service role) may purge a
-- workspace; it does so when the last person in a workspace deletes their account.

revoke execute on function public.purge_organization(uuid) from public, anon, authenticated;
grant execute on function public.purge_organization(uuid) to service_role;

-- Trigger functions can't be called directly anyway; make that explicit.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tasks_assign_seq() from public, anon, authenticated;

-- Row-level security evaluates is_org_member() as the signed-in user, so they keep it; anonymous
-- visitors have no use for it.
revoke execute on function public.is_org_member(uuid) from anon;

-- ── 2. Deleting an account erases the person's name from the activity history ───────────────
-- The history (task_events) stays append-only. The one change now allowed is replacing a deleted
-- person's name inside an entry's details with "Deleted user"; who did what, when, never changes.

create or replace function public.prevent_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('delegate.allow_ledger_purge', true), '') = 'on' then
    return old;
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('delegate.allow_ledger_redact', true), '') = 'on'
     and new.id = old.id and new.org_id = old.org_id and new.type = old.type and new.created_at = old.created_at
     and new.task_id is not distinct from old.task_id
     and new.actor_id is not distinct from old.actor_id
     and new.from_status is not distinct from old.from_status
     and new.to_status is not distinct from old.to_status then
    return new;
  end if;
  raise exception 'task_events is append-only: % is not allowed', tg_op using errcode = '42501';
end $$;

create or replace function public.erase_person_from_history(p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  gone constant jsonb := to_jsonb('Deleted user'::text);
  uid constant text := p_user::text;
  n integer;
begin
  perform set_config('delegate.allow_ledger_redact', 'on', true);
  update public.task_events e
     set meta = e.meta
       || case when e.meta ? 'name' and (e.meta->>'userId' = uid or e.meta#>>'{reassigned,from}' = uid or (e.actor_id = p_user and e.type = 'member.joined'))
               then jsonb_build_object('name', gone) else '{}'::jsonb end
       || case when e.meta ? 'toName' and (e.meta->>'handedTo' = uid or e.meta#>>'{reassigned,to}' = uid)
               then jsonb_build_object('toName', gone) else '{}'::jsonb end
       || case when e.meta ? 'actorName' and e.actor_id = p_user
               then jsonb_build_object('actorName', gone) else '{}'::jsonb end
   where (e.actor_id = p_user or e.meta->>'userId' = uid or e.meta->>'handedTo' = uid
          or e.meta#>>'{reassigned,from}' = uid or e.meta#>>'{reassigned,to}' = uid)
     and (e.meta ? 'name' or e.meta ? 'toName' or e.meta ? 'actorName');
  get diagnostics n = row_count;
  perform set_config('delegate.allow_ledger_redact', 'off', true);
  return n;
end $$;

revoke execute on function public.erase_person_from_history(uuid) from public, anon, authenticated;
grant execute on function public.erase_person_from_history(uuid) to service_role;
