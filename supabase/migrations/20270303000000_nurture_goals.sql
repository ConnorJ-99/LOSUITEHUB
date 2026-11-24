-- MPS HQ: nurture goals, Phase 1 (plan docs/plans/nurture-goals.md; Connor's
-- spec and decisions 2026-11-24).
--
-- 1. nurture_goals: savings, credit and debt goals the loan officer sets for a
--    borrower on a Nurture file: label, start, target, the latest value the
--    borrower reported (and when), the LO's verified value (and when, who),
--    an optional target date, status (not started, in progress, borrower
--    reported complete, LO verified complete), paused, and optionally the
--    1003 debt it's about and the readiness-plan milestone it completes.
--    People who can see the file read and manage them in MPS-HQ.
-- 2. nurture_goal_updates: every change to a goal, never edited or deleted
--    (the audit trail): borrower updates from MyHome, staff updates, target
--    changes and verifications.
-- 3. Borrower updates come only through myhome_goal_update() (the myhome Edge
--    Function, service role): the new value, a nurture_updates row in the
--    file's "Updates from {name}" card for the LO to verify (source myhome),
--    a note on the file, and a myhome_request notice only for "I reached this
--    goal", credit score updates and changes of 10% or more.
-- 4. verify_nurture_goal(): the LO's verified value; "complete" marks the goal
--    LO verified complete and ticks its milestone; a credit goal's verified
--    score also becomes the file's credit score for that borrower. Never
--    changes the stage or pre-approval.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ nurture goals installed").

-- ---------------------------------------------------------------------------
-- 1. Goals
-- ---------------------------------------------------------------------------

create table if not exists public.nurture_goals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  contact_id       uuid not null,
  kind             text not null check (kind in ('savings', 'credit', 'debt')),
  label            text not null check (length(trim(label)) between 1 and 120),
  debt_type        text check (debt_type is null or debt_type in ('credit_card', 'auto', 'installment', 'student', 'collection', 'other')),
  liability_id     uuid references public.liabilities (id) on delete set null,
  milestone_id     uuid references public.readiness_milestones (id) on delete set null,
  start_value      numeric(14, 2) not null check (start_value >= 0),
  target_value     numeric(14, 2) not null check (target_value >= 0),
  current_value    numeric(14, 2) check (current_value >= 0),
  current_at       timestamptz,
  verified_value   numeric(14, 2) check (verified_value >= 0),
  verified_at      timestamptz,
  verified_by      uuid references public.profiles (id) on delete set null,
  target_date      date,
  status           text not null default 'not_started' check (status in ('not_started', 'in_progress', 'reported_complete', 'verified_complete')),
  paused           boolean not null default false,
  sort_order       smallint not null default 0,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint nurture_goals_loan_borrower_fkey foreign key (loan_id, contact_id) references public.loan_borrowers (loan_id, contact_id) on delete cascade,
  constraint nurture_goals_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  -- A credit goal is in score points; savings grows to its target; debt comes down to its target.
  constraint nurture_goals_values_fit check (
    case kind
      when 'credit' then start_value between 300 and 850 and target_value between 300 and 850 and target_value > start_value
        and (current_value is null or current_value between 300 and 850) and (verified_value is null or verified_value between 300 and 850)
      when 'savings' then target_value > start_value
      else target_value < start_value
    end),
  constraint nurture_goals_debt_type check ((kind = 'debt') = (debt_type is not null))
);

create index if not exists nurture_goals_loan_idx on public.nurture_goals (loan_id, sort_order);

drop trigger if exists nurture_goals_set_updated_at on public.nurture_goals;
create trigger nurture_goals_set_updated_at before update on public.nurture_goals
  for each row execute function public.set_updated_at();

alter table public.nurture_goals enable row level security;
drop policy if exists "file members see nurture goals" on public.nurture_goals;
create policy "file members see nurture goals" on public.nurture_goals for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "file members add nurture goals" on public.nurture_goals;
create policy "file members add nurture goals" on public.nurture_goals for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "file members change nurture goals" on public.nurture_goals;
create policy "file members change nurture goals" on public.nurture_goals for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "file members remove nurture goals" on public.nurture_goals;
create policy "file members remove nurture goals" on public.nurture_goals for delete to authenticated using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- 2. The audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.nurture_goal_updates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  loan_id            uuid not null,
  goal_id            uuid not null references public.nurture_goals (id) on delete cascade,
  kind               text not null check (kind in ('balance', 'contribution', 'payment', 'score', 'note', 'reported_complete', 'verified', 'target_changed', 'created')),
  -- The amount typed (a balance, contribution, payment or score), the goal's value before and after.
  amount             numeric(14, 2),
  before_value       numeric(14, 2),
  after_value        numeric(14, 2),
  note               text check (note is null or length(note) <= 500),
  happened_on        date not null default (now() at time zone 'America/Chicago')::date,
  -- Who: the borrower (MyHome) or a person on the team.
  account_id         uuid references public.borrower_accounts (id) on delete set null,
  created_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  nurture_update_id  uuid references public.nurture_updates (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint nurture_goal_updates_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade
);

create index if not exists nurture_goal_updates_goal_idx on public.nurture_goal_updates (goal_id, created_at desc);

alter table public.nurture_goal_updates enable row level security;
drop policy if exists "file members see goal updates" on public.nurture_goal_updates;
create policy "file members see goal updates" on public.nurture_goal_updates for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "file members add goal updates" on public.nurture_goal_updates;
create policy "file members add goal updates" on public.nurture_goal_updates for insert to authenticated
  with check (public.can_see_loan(loan_id) and account_id is null and kind in ('balance', 'contribution', 'payment', 'score', 'note'));
-- No update or delete: the history stays as it happened.
revoke update, delete on public.nurture_goal_updates from anon, authenticated;

-- A new goal and a changed target are written down, whoever made them.
create or replace function public.nurture_goal_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.nurture_goal_updates (organization_id, loan_id, goal_id, kind, after_value, created_by)
    values (new.organization_id, new.loan_id, new.id, 'created', new.target_value, auth.uid());
  elsif new.target_value is distinct from old.target_value then
    insert into public.nurture_goal_updates (organization_id, loan_id, goal_id, kind, before_value, after_value, created_by)
    values (new.organization_id, new.loan_id, new.id, 'target_changed', old.target_value, new.target_value, auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function public.nurture_goal_logged() from public, anon, authenticated;
drop trigger if exists nurture_goals_logged on public.nurture_goals;
create trigger nurture_goals_logged after insert or update of target_value on public.nurture_goals
  for each row execute function public.nurture_goal_logged();

-- ---------------------------------------------------------------------------
-- 3. Borrower updates from MyHome land in the Updates card
-- ---------------------------------------------------------------------------

alter table public.nurture_updates add column if not exists goal_id uuid references public.nurture_goals (id) on delete set null;
alter table public.nurture_updates drop constraint if exists nurture_updates_source_check;
alter table public.nurture_updates add constraint nurture_updates_source_check check (source in ('reply', 'typed', 'myhome'));

/** "$2,400" for money, "605" for a score. */
create or replace function public.nurture_goal_amount(p_kind text, p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then '—' when p_kind = 'credit' then to_char(p_value, 'FM990') else '$' || to_char(p_value, 'FM999,999,990') end
$$;

create or replace function public.myhome_goal_update(p_account uuid, p_goal uuid, p_kind text, p_amount numeric, p_on date, p_note text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  g public.nurture_goals;
  v_loan public.loans;
  v_before numeric;
  v_after numeric;
  v_summary text;
  v_name text;
  v_update uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_big boolean;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  select * into g from public.nurture_goals where id = p_goal;
  if g.id is null or g.contact_id <> a.contact_id or g.organization_id <> a.organization_id then raise exception 'That goal is not yours.'; end if;
  select * into v_loan from public.loans where id = g.loan_id;
  if v_loan.stage <> 'nurture' then raise exception 'This plan isn''t active anymore.'; end if;
  if g.paused then raise exception 'Your loan officer paused this goal.'; end if;
  if g.status = 'verified_complete' then raise exception 'Your loan officer already marked this goal complete.'; end if;
  if p_on is not null and p_on > v_today then raise exception 'Use today or an earlier date.'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  v_before := coalesce(g.current_value, g.start_value);
  v_after := v_before;
  if p_kind = 'reported_complete' then
    null;
  elsif p_kind = 'note' then
    if coalesce(trim(p_note), '') = '' then raise exception 'Write a note.'; end if;
  elsif p_amount is null or p_amount < 0 then
    raise exception 'Enter the amount.';
  elsif g.kind = 'savings' and p_kind = 'balance' then v_after := p_amount;
  elsif g.kind = 'savings' and p_kind = 'contribution' and p_amount > 0 then v_after := v_before + p_amount;
  elsif g.kind = 'credit' and p_kind = 'score' then
    if p_amount < 300 or p_amount > 850 then raise exception 'A credit score is between 300 and 850.'; end if;
    v_after := p_amount;
  elsif g.kind = 'debt' and p_kind = 'balance' then v_after := p_amount;
  elsif g.kind = 'debt' and p_kind = 'payment' and p_amount > 0 then v_after := greatest(v_before - p_amount, 0);
  else
    raise exception 'That update doesn''t fit this goal.';
  end if;

  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = a.contact_id;
  v_summary := case
    when p_kind = 'reported_complete' then 'reported the "' || g.label || '" goal complete'
    when p_kind = 'note' then 'added a note to "' || g.label || '": ' || left(trim(p_note), 300)
    when g.kind = 'savings' and p_kind = 'contribution' then 'added ' || public.nurture_goal_amount('savings', p_amount) || ' to savings (' || public.nurture_goal_amount('savings', v_before) || ' → ' || public.nurture_goal_amount('savings', v_after) || ')'
    when g.kind = 'savings' then 'updated savings from ' || public.nurture_goal_amount('savings', v_before) || ' to ' || public.nurture_goal_amount('savings', v_after)
    when g.kind = 'credit' then 'reported credit score ' || (case when v_after >= v_before then 'up' else 'down' end) || ' from ' || public.nurture_goal_amount('credit', v_before) || ' to ' || public.nurture_goal_amount('credit', v_after)
    when p_kind = 'payment' then 'paid ' || public.nurture_goal_amount('debt', p_amount) || ' toward ' || g.label || ' (' || public.nurture_goal_amount('debt', v_before) || ' → ' || public.nurture_goal_amount('debt', v_after) || ')'
    else 'updated ' || g.label || ' balance from ' || public.nurture_goal_amount('debt', v_before) || ' to ' || public.nurture_goal_amount('debt', v_after)
  end;

  insert into public.nurture_updates (organization_id, loan_id, contact_id, source, status, kind, summary, goal_id)
  values (g.organization_id, g.loan_id, a.contact_id, 'myhome', 'unverified', case when p_kind = 'reported_complete' then 'reported_done' else 'progress' end,
    left(coalesce(v_name, 'The borrower') || ' ' || v_summary || '.', 1000), g.id)
  returning id into v_update;

  insert into public.nurture_goal_updates (organization_id, loan_id, goal_id, kind, amount, before_value, after_value, note, happened_on, account_id, created_by, nurture_update_id)
  values (g.organization_id, g.loan_id, g.id, p_kind, case when p_kind in ('reported_complete', 'note') then null else p_amount end, v_before, v_after,
    nullif(trim(coalesce(p_note, '')), ''), coalesce(p_on, v_today), a.id, null, v_update);

  update public.nurture_goals
  set current_value = case when p_kind in ('reported_complete', 'note') then current_value else v_after end,
      current_at = case when p_kind in ('reported_complete', 'note') then current_at else now() end,
      status = case when p_kind = 'reported_complete' then 'reported_complete' when status = 'not_started' then 'in_progress' else status end
  where id = g.id;

  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (g.organization_id, a.contact_id, g.loan_id, 'note', coalesce(v_name, 'The borrower') || ' ' || v_summary || ' (MyHome).');

  -- Notices only for what needs the LO: a reached goal, a credit score, a change of 10% or more.
  v_big := p_kind = 'reported_complete' or g.kind = 'credit' and p_kind = 'score'
    or (p_kind not in ('note') and v_before > 0 and abs(v_after - v_before) >= v_before * 0.10);
  if v_big then
    perform public.notify_user(g.organization_id, v_loan.assigned_lo_id, 'myhome_request',
      coalesce(v_name, 'A borrower') || ' ' || v_summary, null, '/loans/' || g.loan_id::text || '?tab=myhome', v_update);
  end if;
  return v_after;
end;
$$;

revoke all on function public.nurture_goal_amount(text, numeric) from public, anon;
grant execute on function public.nurture_goal_amount(text, numeric) to authenticated, service_role;
revoke all on function public.myhome_goal_update(uuid, uuid, text, numeric, date, text) from public, anon, authenticated;
grant execute on function public.myhome_goal_update(uuid, uuid, text, numeric, date, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The LO verifies
-- ---------------------------------------------------------------------------

create or replace function public.verify_nurture_goal(p_goal uuid, p_value numeric, p_complete boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g public.nurture_goals;
begin
  if auth.uid() is null then raise exception 'Only the loan officer can verify a goal.'; end if;
  select * into g from public.nurture_goals where id = p_goal;
  if g.id is null then raise exception 'You do not have permission to change this file.'; end if;
  if g.kind = 'credit' and p_value is not null and (p_value < 300 or p_value > 850) then raise exception 'A credit score is between 300 and 850.'; end if;

  update public.nurture_goals
  set verified_value = coalesce(p_value, verified_value),
      verified_at = now(),
      verified_by = auth.uid(),
      status = case when p_complete then 'verified_complete' when status = 'verified_complete' then 'in_progress' else status end,
      paused = case when p_complete then false else paused end
  where id = p_goal;

  insert into public.nurture_goal_updates (organization_id, loan_id, goal_id, kind, amount, before_value, after_value, note)
  values (g.organization_id, g.loan_id, g.id, 'verified', p_value, g.verified_value, coalesce(p_value, g.verified_value), case when p_complete then 'Verified complete' end);

  -- The borrower's open updates on this goal are seen.
  update public.nurture_updates set status = 'verified' where goal_id = g.id and status = 'unverified';

  -- The file's credit score is the verified one (Connor, 2026-11-24).
  if g.kind = 'credit' and p_value is not null then
    update public.loan_borrowers set estimated_credit_score = p_value::smallint where loan_id = g.loan_id and contact_id = g.contact_id;
  end if;

  -- A goal verified complete ticks its readiness-plan milestone (as this person).
  if p_complete and g.milestone_id is not null then
    update public.readiness_milestones set status = 'done' where id = g.milestone_id and status <> 'done';
  end if;
end;
$$;

revoke all on function public.verify_nurture_goal(uuid, numeric, boolean) from public, anon;
grant execute on function public.verify_nurture_goal(uuid, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ nurture goals installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('nurture_goals', 'nurture_goal_updates')) as tables,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('myhome_goal_update', 'verify_nurture_goal', 'nurture_goal_logged', 'nurture_goal_amount')) as functions,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'nurture_updates' and column_name = 'goal_id') as update_link;
