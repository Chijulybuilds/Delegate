-- Delegate · Recall (run after 20261119000000_private_tasks.sql). Safe to run more than once.
--
-- Recall brings a task from an earlier day back onto today's board as a new task. The two are
-- linked both ways; the original keeps its history untouched.

alter table public.tasks add column if not exists recalled_from_id uuid references public.tasks (id) on delete set null;
alter table public.tasks add column if not exists recalled_to_id uuid references public.tasks (id) on delete set null;
create index if not exists tasks_recalled_from_idx on public.tasks (recalled_from_id) where recalled_from_id is not null;
