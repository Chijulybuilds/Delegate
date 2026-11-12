-- =====================================================================================
-- Delegate — initial schema
--
-- Architecture: the Node API is the only writer (service-role key, server-side only).
-- Browsers talk to Supabase solely for Google sign-in and (optionally) Realtime pings.
-- Row Level Security therefore grants authenticated users read access to their own
-- workspace only, and no write access at all. The activity ledger is append-only.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into SQL Editor → Run.
-- =====================================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ enums
do $$ begin
  create type public.task_status as enum ('open', 'in_progress', 'blocked', 'done', 'approved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_role as enum ('owner', 'manager', 'member');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ profiles
-- One row per auth user, created automatically by the trigger at the bottom.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null default '',
  full_name   text not null default '',
  avatar_url  text,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ------------------------------------------------------------------ organizations (tenants)
create table if not exists public.organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 2 and 60),
  slug         text not null unique,
  invite_code  text not null unique,
  plan         text not null default 'starter' check (plan in ('starter', 'team', 'enterprise')),
  status       text not null default 'active' check (status in ('active', 'suspended')),
  timezone     text not null default 'UTC',
  created_at   timestamptz not null default now()
);

create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 40),
  color       text not null default '#6B7280',
  created_at  timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists public.memberships (
  org_id         uuid not null references public.organizations (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  role           public.member_role not null default 'member',
  department_id  uuid references public.departments (id) on delete set null,
  joined_at      timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- MVP: a person belongs to exactly one workspace. Drop this index to allow many.
create unique index if not exists memberships_one_workspace_per_user on public.memberships (user_id);

-- ------------------------------------------------------------------ tasks
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 160),
  description     text not null default '',
  status          public.task_status not null default 'open',
  priority        public.task_priority not null default 'medium',
  assignee_id     uuid not null references public.profiles (id),
  created_by_id   uuid not null references public.profiles (id),
  department_id   uuid references public.departments (id) on delete set null,
  due_at          timestamptz,
  blocked_reason  text,
  waiting_on_id   uuid references public.profiles (id),
  started_at      timestamptz,
  submitted_at    timestamptz,
  approved_at     timestamptz,
  approved_by_id  uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tasks_blocked_has_reason check (status <> 'blocked' or blocked_reason is not null),
  constraint tasks_approved_has_auditor check (status <> 'approved' or (approved_at is not null and approved_by_id is not null))
);
create index if not exists tasks_org_status_idx on public.tasks (org_id, status);
create index if not exists tasks_org_created_idx on public.tasks (org_id, created_at desc);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ proof of work + micro-chat
create table if not exists public.task_proofs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  author_id   uuid not null references public.profiles (id),
  kind        text not null check (kind in ('link', 'note', 'file')),
  url         text,
  note        text,
  file_name   text,
  file_path   text,
  ai_verdict  text check (ai_verdict in ('pass', 'review', 'fail')),
  ai_reason   text,
  created_at  timestamptz not null default now(),
  constraint task_proofs_payload check (
    (kind = 'link' and url is not null) or (kind = 'note' and note is not null) or (kind = 'file' and file_path is not null)
  )
);
create index if not exists task_proofs_task_idx on public.task_proofs (task_id);
create index if not exists task_proofs_org_idx on public.task_proofs (org_id);

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  author_id   uuid not null references public.profiles (id),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

-- ------------------------------------------------------------------ activity ledger (append-only)
create table if not exists public.task_events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  task_id      uuid references public.tasks (id),
  actor_id     uuid,            -- no FK on purpose: the ledger outlives deleted accounts
  type         text not null,
  from_status  public.task_status,
  to_status    public.task_status,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists task_events_org_created_idx on public.task_events (org_id, created_at desc);
create index if not exists task_events_task_idx on public.task_events (task_id, created_at desc);
create index if not exists task_events_created_idx on public.task_events (created_at desc);

-- Nobody — not even the service role — can rewrite history. The only exception is a
-- deliberate tenant purge via public.purge_organization(), which sets a local flag.
create or replace function public.prevent_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('delegate.allow_ledger_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'task_events is append-only: % is not allowed', tg_op using errcode = '42501';
end $$;

drop trigger if exists task_events_immutable on public.task_events;
create trigger task_events_immutable before update or delete on public.task_events
  for each row execute function public.prevent_ledger_mutation();

drop trigger if exists task_events_no_truncate on public.task_events;
create trigger task_events_no_truncate before truncate on public.task_events
  for each statement execute function public.prevent_ledger_mutation();

create or replace function public.purge_organization(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('delegate.allow_ledger_purge', 'on', true);
  delete from public.organizations where id = p_org;
end $$;
revoke execute on function public.purge_organization(uuid) from public;

-- ------------------------------------------------------------------ admin view
-- Read only by the API (service role). security_invoker keeps RLS in force for anyone else.
create or replace view public.admin_org_stats with (security_invoker = true) as
select
  o.id as org_id,
  (select count(*) from public.memberships m where m.org_id = o.id) as members,
  (select count(*) from public.tasks t where t.org_id = o.id) as tasks,
  (select max(e.created_at) from public.task_events e where e.org_id = o.id) as last_activity_at
from public.organizations o;

-- ------------------------------------------------------------------ auth → profile trigger
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ row level security
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.departments   enable row level security;
alter table public.memberships   enable row level security;
alter table public.tasks         enable row level security;
alter table public.task_proofs   enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_events   enable row level security;

-- Browsers never write directly; the API (service role, bypasses RLS) does.
revoke all on public.profiles, public.organizations, public.departments, public.memberships,
  public.tasks, public.task_proofs, public.task_comments, public.task_events, public.admin_org_stats
  from anon, authenticated;
grant select on public.profiles, public.organizations, public.departments, public.memberships,
  public.tasks, public.task_proofs, public.task_comments, public.task_events
  to authenticated;
grant all on public.profiles, public.organizations, public.departments, public.memberships,
  public.tasks, public.task_proofs, public.task_comments, public.task_events, public.admin_org_stats
  to service_role;

drop policy if exists "profiles: self and teammates" on public.profiles;
create policy "profiles: self and teammates" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships mine
      join public.memberships theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );

drop policy if exists "organizations: members read" on public.organizations;
create policy "organizations: members read" on public.organizations for select to authenticated
  using (public.is_org_member(id));

drop policy if exists "departments: members read" on public.departments;
create policy "departments: members read" on public.departments for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "memberships: members read" on public.memberships;
create policy "memberships: members read" on public.memberships for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "tasks: members read" on public.tasks;
create policy "tasks: members read" on public.tasks for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "task_proofs: members read" on public.task_proofs;
create policy "task_proofs: members read" on public.task_proofs for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "task_comments: members read" on public.task_comments;
create policy "task_comments: members read" on public.task_comments for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "task_events: members read" on public.task_events;
create policy "task_events: members read" on public.task_events for select to authenticated
  using (public.is_org_member(org_id));

-- ------------------------------------------------------------------ storage: private proof files
-- No storage policies are created, so only the service role (the API) can read/write.
insert into storage.buckets (id, name, public, file_size_limit)
values ('proofs', 'proofs', false, 10485760)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ realtime heartbeat
-- Lets signed-in browsers receive "something changed" pings for their own workspace (RLS applies).
do $$ begin
  alter publication supabase_realtime add table public.task_events;
exception
  when duplicate_object then null;
  when undefined_object then raise notice 'supabase_realtime publication not found; skipping realtime setup';
end $$;
