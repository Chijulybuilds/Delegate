-- ─────────────────────────────────────────────────────────────────────────────
-- Delegate automation scheduler (run ONCE, after your first Vercel deploy).
--
-- Escalations, overdue alerts, recurring playbooks and the morning brief all run when
-- something calls  /api/cron/tick . Vercel's free (Hobby) plan only allows a daily cron,
-- so this asks Supabase to call it every 10 minutes instead. The tick is idempotent:
-- calling it more often never sends anything twice.
--
-- Before running, replace the two values marked ⬇:
--   1. YOUR-DOMAIN       → your production domain, e.g. delegate-app.vercel.app
--   2. YOUR_CRON_SECRET  → the exact CRON_SECRET you set in Vercel
--
-- Supabase Dashboard → SQL Editor → New query → paste → Run.
-- This file is NOT a migration on purpose: it contains your secret and domain.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret in Supabase Vault instead of in the job text (safe to re-run).
do $$
begin
  if exists (select 1 from vault.secrets where name = 'delegate_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'delegate_cron_secret'), 'YOUR_CRON_SECRET'); -- ⬇ 2
  else
    perform vault.create_secret('YOUR_CRON_SECRET', 'delegate_cron_secret', 'Delegate /api/cron/tick secret'); -- ⬇ 2
  end if;
end $$;

-- Re-running this file replaces the job instead of duplicating it.
select cron.unschedule('delegate-tick') where exists (select 1 from cron.job where jobname = 'delegate-tick');

select cron.schedule(
  'delegate-tick',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-DOMAIN/api/cron/tick', -- ⬇ 1
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'delegate_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Check it is working (after ~10 minutes): status_code should be 200.
--   select id, status_code, left(content::text, 200) as body, created
--   from net._http_response order by created desc limit 5;
--
-- Change the secret later:
--   select vault.update_secret((select id from vault.secrets where name = 'delegate_cron_secret'), 'NEW_SECRET');
--
-- Stop the scheduler:
--   select cron.unschedule('delegate-tick');
