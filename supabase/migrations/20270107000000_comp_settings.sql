-- MPS HQ: compensation settings and the per-loan comp snapshot (build plan Phase 5, second part).
--
-- comp_settings: one row per company (like messaging_settings), owners and
-- admins edit, everyone in the company reads (an LO's comp is shown to them):
--   base_mode            'revenue' (the company revenue on the loan, default)
--                        or 'loan_bps' (loan amount × base_bps)
--   base_bps             the bps for 'loan_bps'
--   company_split_pct    the LO's split on a company-generated lead (35.25)
--   self_split_pct       the LO's split on a self-generated lead (70.25)
-- organization_members.comp_type: 'commission' (default) or 'salary' (100% of
-- the commission goes to company overhead).
-- comp_settings_log: append-only, written only by triggers, every change to
-- the settings or to someone's comp type, readable by owners and admins.
-- loans: lead_source_type ('company' or 'self') and the snapshot taken when
-- the loan is marked Closed (comp_base_mode, comp_base_bps, comp_split_pct,
-- comp_member_type, comp_snapshot_at), so later settings changes never
-- rewrite history. Only owners and admins change the lead source or the
-- snapshot, and every change is in loan_change_log. Gross revenue, LO comp and
-- net to company are calculated on screen (loanComp), never stored.
-- close_loan() now also takes the snapshot. The lead source defaults to
-- company when the file came from a website form or a Page, else self-generated.
-- Apply after the lender comp plans script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ comp settings installed").

create table if not exists public.comp_settings (
  organization_id    uuid primary key,
  base_mode          text not null default 'revenue' check (base_mode in ('revenue', 'loan_bps')),
  base_bps           numeric(7, 2) check (base_bps >= 0 and base_bps <= 1000),
  company_split_pct  numeric(6, 3) not null default 35.25 check (company_split_pct >= 0 and company_split_pct <= 100),
  self_split_pct     numeric(6, 3) not null default 70.25 check (self_split_pct >= 0 and self_split_pct <= 100),
  updated_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  constraint comp_settings_bps_needed check (base_mode <> 'loan_bps' or base_bps is not null),
  constraint comp_settings_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint comp_settings_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null
);

alter table public.comp_settings enable row level security;
drop policy if exists "members see comp settings" on public.comp_settings;
create policy "members see comp settings" on public.comp_settings
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add comp settings" on public.comp_settings;
create policy "managers add comp settings" on public.comp_settings
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit comp settings" on public.comp_settings;
create policy "managers edit comp settings" on public.comp_settings
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));

alter table public.organization_members add column if not exists comp_type text not null default 'commission';
alter table public.organization_members drop constraint if exists organization_members_comp_type_check;
alter table public.organization_members add constraint organization_members_comp_type_check check (comp_type in ('commission', 'salary'));

create table if not exists public.comp_settings_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  what             text not null,
  old_value        text,
  new_value        text,
  changed_by       uuid,
  changed_at       timestamptz not null default now(),
  constraint comp_settings_log_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint comp_settings_log_changed_by_fkey
    foreign key (changed_by) references public.profiles (id) on delete set null
);

create index if not exists comp_settings_log_org_idx on public.comp_settings_log (organization_id, changed_at desc);
alter table public.comp_settings_log enable row level security;
drop policy if exists "managers see comp settings log" on public.comp_settings_log;
create policy "managers see comp settings log" on public.comp_settings_log
  for select to authenticated using (public.is_org_manager(organization_id));
revoke insert, update, delete on public.comp_settings_log from anon, authenticated;

create or replace function public.log_comp_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'comp_settings' then
    insert into public.comp_settings_log (organization_id, what, old_value, new_value, changed_by)
    select new.organization_id, f.what, f.old_value, f.new_value, auth.uid()
    from (values
      ('Comp base', case when tg_op = 'UPDATE' then old.base_mode end, new.base_mode),
      ('Base bps', case when tg_op = 'UPDATE' then old.base_bps::text end, new.base_bps::text),
      ('Company-generated split %', case when tg_op = 'UPDATE' then old.company_split_pct::text end, new.company_split_pct::text),
      ('Self-generated split %', case when tg_op = 'UPDATE' then old.self_split_pct::text end, new.self_split_pct::text)
    ) as f(what, old_value, new_value)
    where f.old_value is distinct from f.new_value;
  elsif tg_op = 'UPDATE' and old.comp_type is distinct from new.comp_type then
    insert into public.comp_settings_log (organization_id, what, old_value, new_value, changed_by)
    select new.organization_id, 'Comp type: ' || coalesce(p.full_name, p.email, 'a team member'), old.comp_type, new.comp_type, auth.uid()
    from public.profiles p where p.id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.log_comp_settings() from public, anon, authenticated;

drop trigger if exists comp_settings_log_changes on public.comp_settings;
create trigger comp_settings_log_changes after insert or update on public.comp_settings
  for each row execute function public.log_comp_settings();
drop trigger if exists organization_members_log_comp_type on public.organization_members;
create trigger organization_members_log_comp_type after update of comp_type on public.organization_members
  for each row execute function public.log_comp_settings();

-- Only owners and admins change someone's comp type (the team trigger already limits role changes).
create or replace function public.guard_member_comp_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.comp_type is distinct from old.comp_type and auth.uid() is not null and not public.is_org_manager(new.organization_id) then
    raise exception 'Only owners and admins can change someone''s comp type.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_member_comp_type() from public, anon, authenticated;
drop trigger if exists organization_members_guard_comp_type on public.organization_members;
create trigger organization_members_guard_comp_type before update of comp_type on public.organization_members
  for each row execute function public.guard_member_comp_type();

-- ---------------------------------------------------------------------------
-- The loan's lead source and comp snapshot.
-- ---------------------------------------------------------------------------

alter table public.loans add column if not exists lead_source_type text;
alter table public.loans add column if not exists comp_base_mode text;
alter table public.loans add column if not exists comp_base_bps numeric(7, 2);
alter table public.loans add column if not exists comp_split_pct numeric(6, 3);
alter table public.loans add column if not exists comp_member_type text;
alter table public.loans add column if not exists comp_snapshot_at timestamptz;

alter table public.loans drop constraint if exists loans_lead_source_type_check;
alter table public.loans add constraint loans_lead_source_type_check check (lead_source_type is null or lead_source_type in ('company', 'self'));
alter table public.loans drop constraint if exists loans_comp_snapshot_check;
alter table public.loans add constraint loans_comp_snapshot_check check (
  (comp_base_mode is null or comp_base_mode in ('revenue', 'loan_bps'))
  and (comp_member_type is null or comp_member_type in ('commission', 'salary'))
  and (comp_split_pct is null or (comp_split_pct >= 0 and comp_split_pct <= 100))
);

-- Company when the file was made by a website form or a Page, else self-generated.
create or replace function public.default_lead_source(p_loan_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.lead_submissions s
    where s.loan_id = p_loan_id and s.outcome in ('new_lead', 'new_loan_existing_person')
  ) then 'company' else 'self' end;
$$;

revoke all on function public.default_lead_source(uuid) from public, anon;
grant execute on function public.default_lead_source(uuid) to authenticated;

-- Only owners and admins change the lead source or the comp snapshot (close_loan takes it as the user closing).
create or replace function public.guard_loan_comp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and coalesce(current_setting('mps.comp_snapshot', true), '') <> 'on'
    and (new.lead_source_type, new.comp_base_mode, new.comp_base_bps, new.comp_split_pct, new.comp_member_type, new.comp_snapshot_at)
      is distinct from (old.lead_source_type, old.comp_base_mode, old.comp_base_bps, old.comp_split_pct, old.comp_member_type, old.comp_snapshot_at)
    and not public.is_org_manager(new.organization_id) then
    raise exception 'Only owners and admins can change the lead source or the comp on a loan.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_loan_comp() from public, anon, authenticated;
drop trigger if exists loans_guard_comp on public.loans;
create trigger loans_guard_comp before update on public.loans
  for each row execute function public.guard_loan_comp();

-- The change log now also covers the comp fields.
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
    ('comp_member_type', old.comp_member_type, new.comp_member_type)
  ) as f(field, old_value, new_value)
  where f.old_value is distinct from f.new_value;
  return new;
end;
$$;

revoke all on function public.log_loan_changes() from public, anon, authenticated;

-- Mark as Closed (Phase 1) now also snapshots the comp settings.
create or replace function public.close_loan(p_loan_id uuid, p_closing_date date, p_funding_date date, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l record;
  s record;
  v_source text;
  v_member text;
begin
  if p_closing_date is null or p_funding_date is null then raise exception 'Enter both the closed and funded dates.'; end if;
  if p_funding_date < p_closing_date then raise exception 'The funded date can''t be before the closed date.'; end if;
  select id, organization_id, assigned_lo_id, lead_source_type into l from public.loans where id = p_loan_id;
  if not found then raise exception 'You do not have permission to change this loan.'; end if;

  select base_mode, base_bps, company_split_pct, self_split_pct into s from public.comp_settings where organization_id = l.organization_id;
  v_source := coalesce(l.lead_source_type, public.default_lead_source(l.id));
  select comp_type into v_member from public.organization_members where organization_id = l.organization_id and user_id = l.assigned_lo_id;

  perform set_config('mps.change_reason', coalesce(p_reason, ''), true);
  perform set_config('mps.comp_snapshot', 'on', true);
  update public.loans set
    stage = 'closed', closing_date = p_closing_date, funding_date = p_funding_date, lost_reason = null,
    lead_source_type = v_source,
    comp_base_mode = coalesce(s.base_mode, 'revenue'),
    comp_base_bps = case when coalesce(s.base_mode, 'revenue') = 'loan_bps' then s.base_bps end,
    comp_split_pct = case when v_source = 'company' then coalesce(s.company_split_pct, 35.25) else coalesce(s.self_split_pct, 70.25) end,
    comp_member_type = coalesce(v_member, 'commission'),
    comp_snapshot_at = now()
  where id = p_loan_id;
  if not found then raise exception 'You do not have permission to change this loan.'; end if;
  perform set_config('mps.comp_snapshot', '', true);
  perform set_config('mps.change_reason', '', true);
end;
$$;

revoke all on function public.close_loan(uuid, date, date, text) from public, anon;
grant execute on function public.close_loan(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ comp settings installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('comp_settings', 'comp_settings_log')) as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('lead_source_type', 'comp_base_mode', 'comp_base_bps', 'comp_split_pct', 'comp_member_type', 'comp_snapshot_at')) as loan_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'organization_members' and column_name = 'comp_type') as member_comp_type,
  (select count(*) from pg_trigger where tgname in ('comp_settings_log_changes', 'organization_members_log_comp_type', 'organization_members_guard_comp_type', 'loans_guard_comp')) as triggers,
  (select count(*) from pg_proc where proname = 'close_loan' and prosrc like '%comp_snapshot%') as close_snapshot;
