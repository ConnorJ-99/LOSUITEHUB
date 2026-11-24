-- MPS HQ: MyHome closed view, Step C (plan docs/plans/myhome.md; Connor
-- 2026-11-24 "go ahead"): equity and "Start something new".
--
-- 1. myhome_settings (one row per company; owners and admins change it):
--    whether a closed file's MyHome shows the refinance card, the equity card
--    and "Start something new", and the smallest monthly savings worth showing
--    ("You may be able to save about $X/mo", default $100). No row = all on.
-- 2. borrower_applications.borrower_account_id: the MyHome account that
--    started an application with "Start something new".
-- 3. myhome_start_application() (the myhome Edge Function, service role):
--    starts a standalone application for the borrower, prefilled by the
--    function (name, email, phone, what they picked), assigned to the file's
--    loan officer, and returns nothing the borrower can't already see; the
--    function hands the page a resume code and only its sha-256 is stored, as
--    on /apply. Leaves a note, a start_new_requested event (marked done like
--    the other asks) and a myhome_request notice. Three a day per account.
--    Submitting it is the usual application: lead intake matches the person.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome Step C installed").

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

create table if not exists public.myhome_settings (
  organization_id      uuid primary key references public.organizations (id) on delete cascade,
  refi_card            boolean not null default true,
  equity_card          boolean not null default true,
  start_new            boolean not null default true,
  min_monthly_savings  numeric(10, 2) not null default 100 check (min_monthly_savings >= 0 and min_monthly_savings <= 10000),
  updated_by           uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at           timestamptz not null default now()
);

drop trigger if exists myhome_settings_set_updated_at on public.myhome_settings;
create trigger myhome_settings_set_updated_at before update on public.myhome_settings
  for each row execute function public.set_updated_at();

alter table public.myhome_settings enable row level security;
drop policy if exists "members read myhome settings" on public.myhome_settings;
create policy "members read myhome settings" on public.myhome_settings for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "owners and admins add myhome settings" on public.myhome_settings;
create policy "owners and admins add myhome settings" on public.myhome_settings for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
drop policy if exists "owners and admins change myhome settings" on public.myhome_settings;
create policy "owners and admins change myhome settings" on public.myhome_settings for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
revoke delete on public.myhome_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Which MyHome account started an application
-- ---------------------------------------------------------------------------

alter table public.borrower_applications add column if not exists borrower_account_id uuid references public.borrower_accounts (id) on delete set null;

-- "Start something new" is an ask Connor marks done like the others.
alter table public.myhome_events drop constraint if exists myhome_events_kind_check;
alter table public.myhome_events add constraint myhome_events_kind_check check (kind in (
  'invited', 'new_code', 'turned_off', 'code_sent', 'code_wrong', 'code_refused', 'signed_in', 'opened',
  'upload', 'pdf', 'home_request', 'numbers_updated',
  'recheck_requested', 'value_check_requested', 'refi_check_requested', 'equity_check_requested', 'start_new', 'start_new_requested'));

-- ---------------------------------------------------------------------------
-- 3. Start something new
-- ---------------------------------------------------------------------------

create or replace function public.myhome_start_application(p_account uuid, p_loan uuid, p_goal text, p_resume_hash text, p_answers jsonb, p_step text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  v_loan public.loans;
  v_lo_email text;
  v_app uuid;
  v_event uuid;
  v_name text;
  v_what text;
begin
  if p_goal not in ('purchase', 'refinance', 'equity') then raise exception 'Pick what you''d like to do.'; end if;
  if p_resume_hash is null or p_resume_hash !~ '^[0-9a-f]{64}$' then raise exception 'The application could not start. Try again.'; end if;
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  select * into v_loan from public.loans where id = p_loan and organization_id = a.organization_id;
  if v_loan.id is null or not exists (select 1 from public.loan_borrowers lb where lb.loan_id = p_loan and lb.contact_id = a.contact_id) then
    raise exception 'That loan is not yours.';
  end if;
  if v_loan.stage <> 'closed' then raise exception 'This loan has not closed.'; end if;
  if exists (select 1 from public.myhome_settings s where s.organization_id = a.organization_id and not s.start_new) then
    raise exception 'Contact your loan officer to start something new.';
  end if;
  if (select count(*) from public.borrower_applications b where b.borrower_account_id = a.id and b.created_at > now() - interval '1 day') >= 3 then
    raise exception 'You started a few applications today already. Please continue the one you started, or try again tomorrow.';
  end if;

  select lower(p.email) into v_lo_email from public.profiles p where p.id = v_loan.assigned_lo_id;
  insert into public.borrower_applications (organization_id, resume_hash, assigned_to_email, answers, step, borrower_account_id)
  values (a.organization_id, p_resume_hash, v_lo_email, coalesce(p_answers, '{}'::jsonb), p_step, a.id)
  returning id into v_app;

  v_what := case p_goal when 'purchase' then 'buying another home' when 'refinance' then 'refinancing their home' else 'borrowing against their equity' end;
  insert into public.myhome_events (organization_id, account_id, contact_id, loan_id, kind, detail)
  values (a.organization_id, a.id, a.contact_id, p_loan, 'start_new_requested', jsonb_build_object('goal', p_goal, 'applicationId', v_app))
  returning id into v_event;
  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = a.contact_id;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (a.organization_id, a.contact_id, p_loan, 'note', coalesce(v_name, 'The borrower') || ' started an application from MyHome about ' || v_what || '.');
  perform public.notify_user(a.organization_id, v_loan.assigned_lo_id, 'myhome_request',
    coalesce(v_name, 'A borrower') || ' started an application about ' || v_what, null, '/loans/' || p_loan::text || '?tab=myhome', v_event);
  return v_app;
end;
$$;

revoke all on function public.myhome_start_application(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.myhome_start_application(uuid, uuid, text, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ MyHome Step C installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'myhome_settings') as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'borrower_applications' and column_name = 'borrower_account_id') as columns,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'myhome_start_application') as functions;
