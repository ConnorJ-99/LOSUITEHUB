-- LOSuite: tasks with no file (office and personal to-dos on the priority list).
--
-- tasks.loan_id becomes optional. A task on a file still follows the file
-- (whoever can see the loan sees its tasks). A task with no file is private:
-- only the person it's assigned to, or who made it, sees or changes it.
-- Admins don't see other people's no-file tasks.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite personal tasks installed").

-- The (loan_id, organization_id) foreign key skips rows with no loan, so a
-- no-file task still needs its organization but no loan.
alter table public.tasks alter column loan_id drop not null;

drop policy if exists "members see tasks on permitted loans" on public.tasks;
drop policy if exists "members read tasks on permitted loans or their own" on public.tasks;
create policy "members read tasks on permitted loans or their own"
  on public.tasks for select to authenticated
  using (
    case when loan_id is null then assigned_to = auth.uid() or created_by = auth.uid()
    else public.can_see_loan(loan_id) end
  );

drop policy if exists "members add tasks to permitted loans" on public.tasks;
drop policy if exists "members add tasks to permitted loans or their own" on public.tasks;
create policy "members add tasks to permitted loans or their own"
  on public.tasks for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and case when loan_id is null then assigned_to = auth.uid() and created_by = auth.uid()
        else public.can_see_loan(loan_id) end
  );

drop policy if exists "members edit tasks on permitted loans" on public.tasks;
drop policy if exists "members edit tasks on permitted loans or their own" on public.tasks;
create policy "members edit tasks on permitted loans or their own"
  on public.tasks for update to authenticated
  using (
    case when loan_id is null then assigned_to = auth.uid() or created_by = auth.uid()
    else public.can_see_loan(loan_id) end
  )
  with check (
    case when loan_id is null then assigned_to = auth.uid() or created_by = auth.uid()
    else public.can_see_loan(loan_id) end
  );

drop policy if exists "members delete tasks on permitted loans" on public.tasks;
drop policy if exists "members delete tasks on permitted loans or their own" on public.tasks;
create policy "members delete tasks on permitted loans or their own"
  on public.tasks for delete to authenticated
  using (
    case when loan_id is null then assigned_to = auth.uid() or created_by = auth.uid()
    else public.can_see_loan(loan_id) end
  );

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite personal tasks installed' as result,
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'loan_id') as file_optional,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname like '%or their own') as task_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tasks') as all_task_policies;
