-- MPS HQ: the "Next Action" tag on leads (Connor, 2026-11-16; plan
-- docs/plans/lead-follow-ups.md, step 2).
--
-- Only files still in a lead stage (lead, contacted, pre_qualified,
-- pre_approved, home_search) have one. It's separate from the stage:
--   waiting_application      prequalled / pre-approved, no application started
--   application_in_progress  the online application is started, not submitted
--   waiting_documents        a checklist item is requested or was rejected
--   needs_lo_review          the application is in and nothing is outstanding
--   ready_to_shop            a pre-approval letter or prequal results PDF issued
--   property_found           a home added after the letter with no letter or
--                            estimate for it yet
--   waiting_borrower         set by hand only
--
-- loans.next_action_auto is what the file's data says, kept current by
-- triggers on the application, the checklist, letters, saved PDFs, homes and
-- stage changes. loans.next_action is what shows: the automatic one, or one
-- Connor picked (next_action_manual). A pick sticks until the data-derived
-- value changes, then the automatic one takes over again. Picking blank goes
-- back to automatic. Every change is in loan_change_log.
--
-- lead_last_contacts(): when each lead file's borrowers last heard from us (our
-- latest text or email, or a call, text, email or meeting note), for the
-- "days since last contact" on cards and the file header.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ lead next action installed").

alter table public.loans
  add column if not exists next_action         text,
  add column if not exists next_action_auto    text,
  add column if not exists next_action_manual  boolean not null default false,
  add column if not exists next_action_at      timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loans_next_action_check') then
    alter table public.loans add constraint loans_next_action_check check (next_action is null or next_action in
      ('waiting_application', 'application_in_progress', 'waiting_documents', 'needs_lo_review', 'ready_to_shop', 'property_found', 'waiting_borrower'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_next_action_auto_check') then
    alter table public.loans add constraint loans_next_action_auto_check check (next_action_auto is null or next_action_auto in
      ('waiting_application', 'application_in_progress', 'waiting_documents', 'needs_lo_review', 'ready_to_shop', 'property_found'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- What the file's data says (mirrored in src/lib/leads/nextAction.ts)
-- ---------------------------------------------------------------------------

create or replace function public.lead_next_action_for(p_loan uuid, p_stage text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_letter timestamptz;
  v_app text;
begin
  if p_stage is null or p_stage not in ('lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search') then
    return null;
  end if;
  -- The latest letter: a pre-approval letter or a prequal results PDF.
  select greatest(
    (select max(x.created_at) from public.preapproval_letters x where x.loan_id = p_loan),
    (select max(d.created_at) from public.loan_documents d where d.loan_id = p_loan and d.kind::text = 'prequal_results')
  ) into v_letter;
  -- A home they found after it, with no letter or estimate for it yet.
  if v_letter is not null and exists (
    select 1 from public.properties p
    where p.loan_id = p_loan and p.status::text in ('interested', 'offer_made') and p.created_at > v_letter
      and not exists (select 1 from public.preapproval_letters x where x.property_id = p.id)
      and not exists (select 1 from public.loan_documents d where d.property_id = p.id and d.kind::text in ('preapproval_letter', 'fee_worksheet', 'loan_comparison'))
  ) then
    return 'property_found';
  end if;
  if exists (select 1 from public.document_requests r where r.loan_id = p_loan and r.status::text in ('requested', 'rejected')) then
    return 'waiting_documents';
  end if;
  if v_letter is not null then
    return 'ready_to_shop';
  end if;
  select case when bool_or(a.status = 'submitted') then 'submitted' when count(*) > 0 then 'in_progress' end
    into v_app from public.borrower_applications a where a.loan_id = p_loan;
  if v_app = 'in_progress' then
    return 'application_in_progress';
  end if;
  if v_app = 'submitted' then
    return 'needs_lo_review';
  end if;
  if p_stage in ('pre_qualified', 'pre_approved', 'home_search') then
    return 'waiting_application';
  end if;
  return null;
end;
$$;

revoke all on function public.lead_next_action_for(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- On the loan: the automatic value, a pick that sticks, back to automatic
-- ---------------------------------------------------------------------------

create or replace function public.loans_next_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.next_action_auto := public.lead_next_action_for(new.id, new.stage::text);
  elsif new.next_action_auto is distinct from old.next_action_auto
    and coalesce(current_setting('mps.next_action_refresh', true), '') <> 'on' then
    new.next_action_auto := old.next_action_auto; -- Only the file's data sets it.
  end if;

  if new.stage::text not in ('lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search') then
    new.next_action := null;
    new.next_action_manual := false;
  elsif tg_op = 'INSERT' or new.next_action_auto is distinct from old.next_action_auto then
    -- The data changed: the automatic value takes over again.
    new.next_action := new.next_action_auto;
    new.next_action_manual := false;
  elsif new.next_action is distinct from old.next_action then
    if new.next_action is null then
      new.next_action := new.next_action_auto;
      new.next_action_manual := false;
    else
      new.next_action_manual := new.next_action is distinct from new.next_action_auto;
    end if;
  else
    new.next_action_manual := old.next_action_manual;
  end if;

  if tg_op = 'INSERT' or new.next_action is distinct from old.next_action then
    new.next_action_at := case when new.next_action is null then null else now() end;
  end if;
  return new;
end;
$$;

revoke all on function public.loans_next_action() from public, anon, authenticated;

drop trigger if exists loans_next_action on public.loans;
create trigger loans_next_action before insert or update on public.loans
  for each row execute function public.loans_next_action();

-- Re-works out one file's automatic value (run by the triggers below).
create or replace function public.refresh_lead_next_action(p_loan uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auto text;
  v_reason text := current_setting('mps.change_reason', true);
begin
  if p_loan is null then
    return;
  end if;
  select public.lead_next_action_for(l.id, l.stage::text) into v_auto
  from public.loans l where l.id = p_loan and l.next_action_auto is distinct from public.lead_next_action_for(l.id, l.stage::text);
  if not found then
    return; -- Unchanged, or the file is gone.
  end if;
  perform set_config('mps.next_action_refresh', 'on', true);
  if coalesce(v_reason, '') = '' then
    perform set_config('mps.change_reason', 'Automatic (from the file)', true);
  end if;
  update public.loans set next_action_auto = v_auto where id = p_loan;
  perform set_config('mps.next_action_refresh', '', true);
  perform set_config('mps.change_reason', coalesce(v_reason, ''), true);
end;
$$;

revoke all on function public.refresh_lead_next_action(uuid) from public, anon, authenticated;

create or replace function public.next_action_child_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_lead_next_action(old.loan_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.loan_id is distinct from old.loan_id) then
    perform public.refresh_lead_next_action(new.loan_id);
  end if;
  return null;
end;
$$;

revoke all on function public.next_action_child_changed() from public, anon, authenticated;

drop trigger if exists document_requests_next_action on public.document_requests;
create trigger document_requests_next_action after insert or update or delete on public.document_requests
  for each row execute function public.next_action_child_changed();

drop trigger if exists borrower_applications_next_action on public.borrower_applications;
create trigger borrower_applications_next_action after insert or update or delete on public.borrower_applications
  for each row execute function public.next_action_child_changed();

drop trigger if exists preapproval_letters_next_action on public.preapproval_letters;
create trigger preapproval_letters_next_action after insert or update or delete on public.preapproval_letters
  for each row execute function public.next_action_child_changed();

drop trigger if exists loan_documents_next_action on public.loan_documents;
create trigger loan_documents_next_action after insert or update or delete on public.loan_documents
  for each row execute function public.next_action_child_changed();

drop trigger if exists properties_next_action on public.properties;
create trigger properties_next_action after insert or update or delete on public.properties
  for each row execute function public.next_action_child_changed();

-- ---------------------------------------------------------------------------
-- The change log also covers the Next Action
-- ---------------------------------------------------------------------------

create or replace function public.log_loan_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(current_setting('mps.change_reason', true)), '');
  v_by uuid := auth.uid();
begin
  insert into public.loan_change_log (organization_id, loan_id, field, old_value, new_value, changed_by, reason)
  select new.organization_id, new.id, f.field, f.old_value, f.new_value, v_by, v_reason
  from (values
    ('closing_date', old.closing_date::text, new.closing_date::text),
    ('funding_date', old.funding_date::text, new.funding_date::text),
    ('revenue_type', old.revenue_type::text, new.revenue_type::text),
    ('revenue_value', old.revenue_value::text, new.revenue_value::text),
    ('assigned_lo_id', old.assigned_lo_id::text, new.assigned_lo_id::text),
    ('comp_plan_id', old.comp_plan_id::text, new.comp_plan_id::text),
    ('lead_source_type', old.lead_source_type, new.lead_source_type),
    ('comp_base_mode', old.comp_base_mode, new.comp_base_mode),
    ('comp_base_bps', old.comp_base_bps::text, new.comp_base_bps::text),
    ('comp_split_pct', old.comp_split_pct::text, new.comp_split_pct::text),
    ('comp_member_type', old.comp_member_type, new.comp_member_type),
    ('comp_confirmed_at', old.comp_confirmed_at::text, new.comp_confirmed_at::text),
    ('comp_paid_on', old.comp_paid_on::text, new.comp_paid_on::text),
    ('review_status', old.review_status, new.review_status),
    ('review_received_on', old.review_received_on::text, new.review_received_on::text),
    ('review_skip', old.review_skip::text, new.review_skip::text),
    ('next_action', old.next_action, new.next_action)
  ) as f(field, old_value, new_value)
  where f.old_value is distinct from f.new_value;
  return new;
end;
$$;

revoke all on function public.log_loan_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Days since last contact (the files you can see; null p_loan = every lead file)
-- ---------------------------------------------------------------------------

create or replace function public.lead_last_contacts(p_loan uuid default null)
returns table (loan_id uuid, last_contact_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id,
    greatest(
      (select max(m.sent_at) from public.messages m
        where m.direction::text = 'outbound' and m.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id)),
      (select max(n.created_at) from public.notes n
        where n.kind::text in ('call', 'text', 'email', 'meeting') and n.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id))
    )
  from public.loans l
  where (p_loan is null and l.stage::text in ('lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search'))
     or l.id = p_loan;
$$;

revoke all on function public.lead_last_contacts(uuid) from public, anon;
grant execute on function public.lead_last_contacts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Every lead file gets its value now
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('mps.next_action_refresh', 'on', true);
  perform set_config('mps.change_reason', 'Next Action set up', true);
  update public.loans l set next_action_auto = public.lead_next_action_for(l.id, l.stage::text)
  where l.next_action_auto is distinct from public.lead_next_action_for(l.id, l.stage::text);
  perform set_config('mps.next_action_refresh', '', true);
  perform set_config('mps.change_reason', '', true);
end $$;

select
  'MPS HQ lead next action installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('next_action', 'next_action_auto', 'next_action_manual', 'next_action_at')) as columns,
  (select count(*) from public.loans where next_action is not null) as leads_tagged;
