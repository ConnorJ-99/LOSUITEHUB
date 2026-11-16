-- MPS HQ: Buyer Recovery & Nurture, Steps 2–3 (Connor, 2026-11-16; plan
-- docs/plans/buyer-nurture.md). Built on the existing Nurture stage: no new
-- pipeline, nothing copied.
--
-- loans gains, while stage = 'nurture':
--   nurture_stage      initial_review → plan_needed → plan_generated →
--                      plan_delivered → working → waiting_milestone →
--                      ready_reassess → ready_prequal → paused
--                      ("Closed / No Longer Interested" = Lost, with its reason)
--   nurture_entered_at when it last moved into Nurture
--   nurture_obstacles  readiness obstacles (keys from src/lib/nurture/obstacles.ts,
--                      or "custom:<words>")
--   nurture_target     target purchase time frame (their words)
--   nurture_note       the note from the move
--   nurture_next_follow_up  the next follow-up date
--   partner_status     realtor-safe words ("Preparing for Homeownership") for
--                      the realtor portal later; never figures
-- A trigger fills nurture_entered_at, nurture_stage (Initial Review unless the
-- move set one) and partner_status on the way in, and clears the stage and
-- partner status on the way out (obstacles, target and note stay as history).
-- move_to_nurture(): the one action behind "Move to Nurture" and Change
-- status → Nurture (at least one obstacle; Plan Needed; a note on the file).
-- Stage and obstacle changes are in loan_change_log. Files already in Nurture
-- start at Initial Review.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ nurture installed").

alter table public.loans
  add column if not exists nurture_stage           text,
  add column if not exists nurture_entered_at      timestamptz,
  add column if not exists nurture_obstacles       text[] not null default '{}',
  add column if not exists nurture_target          text,
  add column if not exists nurture_note            text,
  add column if not exists nurture_next_follow_up  date,
  add column if not exists partner_status          text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loans_nurture_stage_check') then
    alter table public.loans add constraint loans_nurture_stage_check check (nurture_stage is null or nurture_stage in
      ('initial_review', 'plan_needed', 'plan_generated', 'plan_delivered', 'working', 'waiting_milestone', 'ready_reassess', 'ready_prequal', 'paused'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_nurture_text_check') then
    alter table public.loans add constraint loans_nurture_text_check check (
      (nurture_target is null or length(nurture_target) <= 200)
      and (nurture_note is null or length(nurture_note) <= 2000)
      and (partner_status is null or length(partner_status) <= 120)
      and cardinality(nurture_obstacles) <= 30);
  end if;
end $$;

-- An obstacle is one of the known keys or "custom:<1–120 characters>".
create or replace function public.nurture_obstacle_ok(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p = any (array[
      'credit_score_low', 'credit_recent_lates', 'credit_collections', 'credit_utilization', 'credit_limited_history', 'credit_errors',
      'debt_dti_high', 'debt_revolving', 'debt_monthly', 'debt_student_loans', 'debt_auto_loan',
      'income_insufficient', 'income_short_history', 'income_self_employed_docs', 'income_variable', 'income_missing_docs',
      'assets_down_payment', 'assets_closing_funds', 'assets_missing_docs', 'assets_unverified_deposits', 'assets_reserves',
      'other_lease', 'other_buying_later', 'other_sell_home'])
    or p ~ '^custom:.{1,120}$';
$$;

create or replace function public.loans_nurture_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.nurture_obstacles) o where not public.nurture_obstacle_ok(o)) then
    raise exception 'Unknown readiness obstacle.';
  end if;
  if new.stage::text = 'nurture' then
    if tg_op = 'INSERT' or old.stage is distinct from new.stage then
      new.nurture_entered_at := now();
      new.nurture_stage := coalesce(new.nurture_stage, 'initial_review');
      new.partner_status := 'Preparing for Homeownership';
    end if;
    new.nurture_stage := coalesce(new.nurture_stage, 'initial_review');
  else
    new.nurture_stage := null;
    new.partner_status := null;
  end if;
  return new;
end;
$$;

drop trigger if exists loans_nurture_fields on public.loans;
create trigger loans_nurture_fields before insert or update on public.loans
  for each row execute function public.loans_nurture_fields();

-- The one "Move to Nurture" action (also used for editing obstacles while in Nurture).
create or replace function public.move_to_nurture(p_loan_id uuid, p_obstacles text[], p_target text default null, p_note text default null, p_summary text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_stage text;
  v_contact uuid;
begin
  if coalesce(cardinality(p_obstacles), 0) = 0 then
    raise exception 'Pick at least one readiness obstacle.';
  end if;
  select l.organization_id, l.stage::text into v_org, v_stage from public.loans l where l.id = p_loan_id;
  if v_org is null then raise exception 'You do not have permission to change this file.'; end if;
  if v_stage = 'closed' then raise exception 'A closed loan can''t move to Nurture.'; end if;
  if v_stage = 'nurture' then
    update public.loans set nurture_obstacles = p_obstacles, nurture_target = nullif(trim(p_target), ''), nurture_note = nullif(trim(p_note), '')
    where id = p_loan_id;
  else
    update public.loans set stage = 'nurture', nurture_stage = 'plan_needed', nurture_obstacles = p_obstacles,
      nurture_target = nullif(trim(p_target), ''), nurture_note = nullif(trim(p_note), '')
    where id = p_loan_id;
  end if;
  if not found then raise exception 'You do not have permission to change this file.'; end if;
  select b.contact_id into v_contact from public.loan_borrowers b where b.loan_id = p_loan_id and b.role = 'primary' limit 1;
  if v_contact is not null and v_stage <> 'nurture' then
    insert into public.notes (organization_id, contact_id, loan_id, kind, body)
    values (v_org, v_contact, p_loan_id, 'note', left(
      'Moved to Nurture.' || coalesce(' Obstacles: ' || nullif(trim(p_summary), '') || '.', '')
      || coalesce(' Target: ' || nullif(trim(p_target), '') || '.', '')
      || coalesce(' Note: ' || nullif(trim(p_note), ''), ''), 4000));
  end if;
end;
$$;

revoke all on function public.move_to_nurture(uuid, text[], text, text, text) from public, anon;
grant execute on function public.move_to_nurture(uuid, text[], text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The change log also covers the nurture stage and obstacles
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
    ('next_action', old.next_action, new.next_action),
    ('nurture_stage', old.nurture_stage, new.nurture_stage),
    ('nurture_obstacles', old.nurture_obstacles::text, new.nurture_obstacles::text),
    ('nurture_next_follow_up', old.nurture_next_follow_up::text, new.nurture_next_follow_up::text)
  ) as f(field, old_value, new_value)
  where f.old_value is distinct from f.new_value;
  return new;
end;
$$;

revoke all on function public.log_loan_changes() from public, anon, authenticated;

-- Files already in Nurture start at Initial Review.
update public.loans
set nurture_stage = 'initial_review', nurture_entered_at = coalesce(nurture_entered_at, stage_changed_at), partner_status = 'Preparing for Homeownership'
where stage::text = 'nurture' and nurture_stage is null;

select
  'MPS HQ nurture installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('nurture_stage', 'nurture_entered_at', 'nurture_obstacles', 'nurture_target', 'nurture_note', 'nurture_next_follow_up', 'partner_status')) as columns,
  (select count(*) from public.loans where stage::text = 'nurture') as nurture_files;
