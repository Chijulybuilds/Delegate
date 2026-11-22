-- Task size: how big a task is, so Insights can judge everyone fairly (a quick call and a day of
-- video editing aren't measured by the same clock).
--   xs Quick · s Small · m Medium · l Large · xl Huge   (empty = not set, counts as Medium)
--
-- Safe to run more than once. Until it's run, the app keeps working; tasks just save without a size.

alter table public.tasks add column if not exists size text;

do $$
begin
  alter table public.tasks add constraint tasks_size_check check (size is null or size in ('xs', 's', 'm', 'l', 'xl'));
exception when duplicate_object then null;
end $$;

-- Let the API see the new column straight away.
notify pgrst, 'reload schema';
