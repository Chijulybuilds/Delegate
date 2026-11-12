-- =====================================================================================
-- Delegate — v2: billing, integrations, notifications, playbooks, escalations
-- Run after 20261112000000_init.sql. Safe to re-run.
-- =====================================================================================

-- ------------------------------------------------------------------ profiles: WhatsApp phone
alter table public.profiles add column if not exists phone text;
create unique index if not exists profiles_phone_key on public.profiles (phone) where phone is not null;

-- ------------------------------------------------------------------ organizations
alter table public.organizations add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.organizations add column if not exists task_seq integer not null default 0;

-- ------------------------------------------------------------------ tasks
alter table public.tasks add column if not exists seq integer;
alter table public.tasks add column if not exists source text not null default 'app';
alter table public.tasks add column if not exists blocked_at timestamptz;
alter table public.tasks add column if not exists escalation_level smallint not null default 0;
alter table public.tasks add column if not exists overdue_alerted_at timestamptz;
alter table public.tasks add column if not exists playbook_id uuid;
alter table public.tasks add column if not exists occurrence_key text;

do $$ begin
  alter table public.tasks add constraint tasks_source_check
    check (source in ('app', 'slack', 'teams', 'whatsapp', 'playbook', 'github'));
exception when duplicate_object then null; end $$;

-- Human task numbers (DLG-<seq>), per workspace. Backfill existing rows in creation order.
with numbered as (
  select id, row_number() over (partition by org_id order by created_at, id) as rn
  from public.tasks where seq is null
)
update public.tasks t set seq = n.rn from numbered n where t.id = n.id;

update public.organizations o
set task_seq = greatest(o.task_seq, coalesce((select max(seq) from public.tasks t where t.org_id = o.id), 0));

alter table public.tasks alter column seq set not null;
create unique index if not exists tasks_org_seq on public.tasks (org_id, seq);
create unique index if not exists tasks_occurrence_key on public.tasks (occurrence_key) where occurrence_key is not null;
create index if not exists tasks_open_status_idx on public.tasks (status) where status in ('open', 'in_progress', 'blocked');

create or replace function public.tasks_assign_seq() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.seq is null then
    -- Row lock on the workspace serialises concurrent inserts: numbers never collide.
    update public.organizations set task_seq = task_seq + 1 where id = new.org_id returning task_seq into new.seq;
  end if;
  return new;
end $$;
revoke execute on function public.tasks_assign_seq() from public;

drop trigger if exists tasks_assign_seq on public.tasks;
create trigger tasks_assign_seq before insert on public.tasks
  for each row execute function public.tasks_assign_seq();

-- ------------------------------------------------------------------ proofs: provenance
alter table public.task_proofs add column if not exists source text not null default 'manual';
alter table public.task_proofs add column if not exists verified boolean not null default false;
do $$ begin
  alter table public.task_proofs add constraint task_proofs_source_check check (source in ('manual', 'github', 'gdrive', 'whatsapp'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ billing
create table if not exists public.subscriptions (
  org_id                    uuid primary key references public.organizations (id) on delete cascade,
  plan                      text not null default 'starter' check (plan in ('starter', 'team', 'enterprise')),
  status                    text not null default 'none' check (status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  provider                  text check (provider in ('stripe', 'paystack', 'manual')),
  seats                     integer not null default 0,
  trial_ends_at             timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  provider_customer_id      text,
  provider_subscription_id  text,
  updated_at                timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on public.subscriptions (provider_customer_id);
create index if not exists subscriptions_provider_sub_idx on public.subscriptions (provider_subscription_id);

-- Every existing workspace gets the standard 14-day Team trial.
insert into public.subscriptions (org_id, plan, status, trial_ends_at)
select id, 'team', 'trialing', now() + interval '14 days' from public.organizations
on conflict (org_id) do nothing;

-- Webhook replay protection (Stripe/Paystack/GitHub/WhatsApp delivery ids).
create table if not exists public.webhook_events (
  provider     text not null,
  event_id     text not null,
  received_at  timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ------------------------------------------------------------------ integrations
create table if not exists public.integrations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  provider       text not null check (provider in ('slack', 'teams', 'whatsapp', 'github', 'gdrive')),
  config         jsonb not null default '{}'::jsonb,   -- non-secret
  secret         text,                                  -- AES-256-GCM ciphertext (APP_ENCRYPTION_KEY)
  events         text[] not null default '{}',
  status         text not null default 'connected' check (status in ('connected', 'error')),
  last_error     text,
  created_by_id  uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, provider)
);
create index if not exists integrations_slack_team_idx on public.integrations ((config ->> 'teamId')) where provider = 'slack';

create table if not exists public.outbound_messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  channel     text not null check (channel in ('slack', 'teams', 'whatsapp', 'email')),
  target      text not null,
  summary     text not null,
  status      text not null check (status in ('sent', 'failed', 'skipped', 'simulated')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists outbound_messages_org_idx on public.outbound_messages (org_id, created_at desc);

create table if not exists public.link_codes (
  code        text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists link_codes_user_idx on public.link_codes (user_id);

-- ------------------------------------------------------------------ notifications
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null default '',
  task_id     uuid references public.tasks (id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ------------------------------------------------------------------ playbooks
create table if not exists public.playbooks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  name           text not null check (char_length(name) between 2 and 80),
  active         boolean not null default true,
  cadence        text not null check (cadence in ('daily', 'weekdays', 'weekly', 'monthly')),
  weekday        smallint check (weekday between 0 and 6),
  month_day      smallint check (month_day between 1 and 28),
  time_of_day    text not null default '08:00' check (time_of_day ~ '^[0-2][0-9]:[0-5][0-9]$'),
  items          jsonb not null default '[]'::jsonb,
  created_by_id  uuid references public.profiles (id) on delete set null,
  last_run_on    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists playbooks_org_idx on public.playbooks (org_id);

do $$ begin
  alter table public.tasks add constraint tasks_playbook_fk foreign key (playbook_id) references public.playbooks (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ row level security
alter table public.subscriptions     enable row level security;
alter table public.webhook_events    enable row level security;
alter table public.integrations      enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.link_codes        enable row level security;
alter table public.notifications     enable row level security;
alter table public.playbooks         enable row level security;

revoke all on public.subscriptions, public.webhook_events, public.integrations, public.outbound_messages,
  public.link_codes, public.notifications, public.playbooks from anon, authenticated;
-- Readable by signed-in members (scoped by the policies below). Secrets tables stay API-only.
grant select on public.subscriptions, public.notifications, public.playbooks to authenticated;
grant all on public.subscriptions, public.webhook_events, public.integrations, public.outbound_messages,
  public.link_codes, public.notifications, public.playbooks to service_role;

drop policy if exists "subscriptions: members read" on public.subscriptions;
create policy "subscriptions: members read" on public.subscriptions for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "notifications: own" on public.notifications;
create policy "notifications: own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "playbooks: members read" on public.playbooks;
create policy "playbooks: members read" on public.playbooks for select to authenticated
  using (public.is_org_member(org_id));
