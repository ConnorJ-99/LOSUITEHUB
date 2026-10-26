-- LOSuite: lead intake part 5b (the "From the website" list on Today).
--
-- A web form shows on Today until someone marks it handled. Submissions
-- stay read-only otherwise, so marking is done through a function that
-- changes only the handled fields, for people who can see that submission.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite web forms handled installed").

alter table public.lead_submissions
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by uuid;

do $$ begin
  alter table public.lead_submissions
    add constraint lead_submissions_handled_by_fkey foreign key (handled_by) references public.profiles (id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists lead_submissions_open_idx on public.lead_submissions (organization_id, received_at desc) where handled_at is null;

-- Marks one submission handled (or not handled again), if the caller can see it.
create or replace function public.mark_submission_handled(p_id uuid, p_handled boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lead_submissions;
begin
  select * into v_row from public.lead_submissions where id = p_id;
  if not found then return false; end if;
  if not (
    case
      when v_row.loan_id is not null then public.can_see_loan(v_row.loan_id)
      when v_row.contact_id is not null then public.can_see_contact(v_row.contact_id)
      else public.is_org_member(v_row.organization_id)
    end
  ) then
    return false;
  end if;
  update public.lead_submissions
  set handled_at = case when p_handled then now() end,
      handled_by = case when p_handled then auth.uid() end
  where id = p_id;
  return true;
end;
$$;

revoke all on function public.mark_submission_handled(uuid, boolean) from public;
do $$ begin
  grant execute on function public.mark_submission_handled(uuid, boolean) to authenticated;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite web forms handled installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'lead_submissions' and column_name in ('handled_at', 'handled_by')) as handled_columns,
  (select count(*) from pg_proc where proname = 'mark_submission_handled') as handled_function;
