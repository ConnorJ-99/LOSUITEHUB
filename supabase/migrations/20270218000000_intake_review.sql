-- MPS HQ: Loan Officer Assistant, step 5: the loan officer's review of an intake (Connor, 2026-11-17).
--
-- save_intake_summary(id, summary): stores the review summary (worked out in
--   the app from the answers, plus the AI's plain-English paragraph when the
--   assistant is on) on a submitted intake. People on the interview only.
-- accept_intake(id, mapping, note): the file's loan officer or an admin
--   accepts it. The answers fill the file's BLANKS only (nothing typed is
--   replaced): the primary borrower's email and phone, the purchase price, the
--   estimated credit score, jobs, other income, accounts, debts, and the
--   realtor as the buyer's agent when the file has none. A lead moves to
--   Contacted (Connor marks Pre-Qualified himself). A note is left on the file.
-- return_intake(id, note): sends it back to the interviewer with a question
--   (a note is required); it opens for edits again, and they get a
--   notification and an item on their Today.
-- Either decision closes the loan officer's "Intake ready" item.
--
-- Needs 20270217000000_intake_interviews.sql first. Safe to run more than
-- once. A full run ends with a confirmation row ("MPS HQ intake review installed").

-- ---------------------------------------------------------------------------
-- 1. The summary
-- ---------------------------------------------------------------------------

create or replace function public.save_intake_summary(p_id uuid, p_summary jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.intake_interviews%rowtype;
begin
  select * into v from public.intake_interviews where id = p_id;
  if v.id is null or not (v.interviewer_user_id = auth.uid() or public.file_role(v.loan_id) in ('lo', 'admin')) then
    raise exception 'That intake interview was not found, or it is not yours.';
  end if;
  if v.status = 'draft' then
    raise exception 'Submit the intake first.';
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'That summary could not be read.';
  end if;
  perform set_config('mps.intake_change', 'on', true);
  update public.intake_interviews set summary = p_summary where id = p_id;
  perform set_config('mps.intake_change', '', true);
end;
$$;

revoke all on function public.save_intake_summary(uuid, jsonb) from public, anon;
grant execute on function public.save_intake_summary(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Accept: fill the file's blanks
-- ---------------------------------------------------------------------------

create or replace function public.accept_intake(p_id uuid, p_mapping jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.intake_interviews%rowtype;
  l        record;
  v_person uuid;
  x        jsonb;
  m        jsonb := coalesce(p_mapping, '{}'::jsonb);
  n_jobs   int := 0;
  n_income int := 0;
  n_assets int := 0;
  n_debts  int := 0;
  v_moved  boolean := false;
  v_realtor boolean := false;
  v_by     text;
begin
  select * into v from public.intake_interviews where id = p_id;
  if v.id is null or coalesce(public.file_role(v.loan_id), '') not in ('lo', 'admin') then
    raise exception 'Only this file''s loan officer or an admin can accept an intake.';
  end if;
  if v.status <> 'submitted' then
    raise exception 'Only a submitted intake can be accepted.';
  end if;
  select id, organization_id, stage::text as stage, purpose::text as purpose, purchase_price into l from public.loans where id = v.loan_id;
  select lb.contact_id into v_person from public.loan_borrowers lb where lb.loan_id = v.loan_id order by (lb.role::text = 'primary') desc limit 1;

  -- The person: email and phone only where blank.
  if v_person is not null then
    update public.contacts set
      email = coalesce(nullif(trim(email), ''), nullif(lower(trim(m->'person'->>'email')), '')),
      phone = coalesce(nullif(trim(phone), ''), nullif(m->'person'->>'phone', ''))
    where id = v_person;
    update public.loan_borrowers set estimated_credit_score = coalesce(estimated_credit_score, nullif(m->'loan'->>'estimatedScore', '')::smallint)
    where loan_id = v.loan_id and contact_id = v_person;
  end if;

  -- The price, when the file has none.
  if l.purchase_price is null and nullif(m->'loan'->>'purchasePrice', '') is not null then
    update public.loans set purchase_price = (m->'loan'->>'purchasePrice')::numeric where id = v.loan_id;
  end if;

  if v_person is not null then
    -- Jobs (a job already on the 1003 with that employer is left alone).
    for x in select * from jsonb_array_elements(coalesce(m->'jobs', '[]'::jsonb)) loop
      continue when coalesce(trim(x->>'employer'), '') = '';
      continue when exists (select 1 from public.employments e where e.contact_id = v_person and lower(trim(e.employer_name)) = lower(trim(x->>'employer')));
      insert into public.employments (organization_id, contact_id, status, employer_name, position_title, start_date, is_self_employed, ownership_25_or_more, base_income, self_employed_income, sort_order)
      values (l.organization_id, v_person, 'current', left(trim(x->>'employer'), 200), nullif(left(trim(coalesce(x->>'title', '')), 120), ''),
        nullif(x->>'startDate', '')::date, coalesce((x->>'selfEmployed')::boolean, false),
        case when nullif(x->>'ownershipPct', '') is not null then (x->>'ownershipPct')::numeric >= 25 end,
        case when not coalesce((x->>'selfEmployed')::boolean, false) then nullif(x->>'monthlyIncome', '')::numeric end,
        case when coalesce((x->>'selfEmployed')::boolean, false) then nullif(x->>'monthlyIncome', '')::numeric end, 100);
      n_jobs := n_jobs + 1;
    end loop;
    -- Other income (one of each kind).
    for x in select * from jsonb_array_elements(coalesce(m->'otherIncome', '[]'::jsonb)) loop
      continue when nullif(x->>'monthly', '') is null;
      continue when exists (select 1 from public.other_incomes o where o.contact_id = v_person and o.income_type::text = x->>'kind');
      insert into public.other_incomes (organization_id, contact_id, income_type, monthly_amount)
      values (l.organization_id, v_person, (x->>'kind')::public.other_income_type, (x->>'monthly')::numeric);
      n_income := n_income + 1;
    end loop;
    -- Accounts (the same kind and amount isn't added twice).
    for x in select * from jsonb_array_elements(coalesce(m->'assets', '[]'::jsonb)) loop
      continue when nullif(x->>'amount', '') is null;
      continue when exists (select 1 from public.assets s where s.loan_id = v.loan_id and s.contact_id = v_person and s.asset_type::text = x->>'kind' and s.amount = (x->>'amount')::numeric);
      insert into public.assets (loan_id, contact_id, asset_type, institution_name, amount)
      values (v.loan_id, v_person, (x->>'kind')::public.asset_type, nullif(left(trim(coalesce(x->>'institution', '')), 120), ''), (x->>'amount')::numeric);
      n_assets := n_assets + 1;
    end loop;
    -- Debts (the same kind and creditor isn't added twice).
    for x in select * from jsonb_array_elements(coalesce(m->'debts', '[]'::jsonb)) loop
      continue when nullif(x->>'monthlyPayment', '') is null;
      continue when exists (select 1 from public.liabilities d where d.loan_id = v.loan_id and d.contact_id = v_person and d.liability_type::text = x->>'kind'
        and lower(coalesce(d.creditor_name, '')) = lower(coalesce(trim(x->>'creditor'), '')));
      insert into public.liabilities (loan_id, contact_id, liability_type, creditor_name, unpaid_balance, monthly_payment)
      values (v.loan_id, v_person, (x->>'kind')::public.liability_type, nullif(left(trim(coalesce(x->>'creditor', '')), 120), ''), nullif(x->>'balance', '')::numeric, (x->>'monthlyPayment')::numeric);
      n_debts := n_debts + 1;
    end loop;
  end if;

  -- The realtor: the buyer's agent on a purchase with none yet.
  x := m->'realtor';
  if l.purpose = 'purchase' and x is not null and jsonb_typeof(x) = 'object' and coalesce(trim(x->>'name'), '') <> ''
    and not exists (select 1 from public.loan_team_members t where t.loan_id = v.loan_id and t.role::text = 'buyer_agent') then
    insert into public.loan_team_members (organization_id, loan_id, role, partner_id, name, phone)
    values (l.organization_id, v.loan_id, 'buyer_agent',
      (select p.id from public.partners p where p.id = nullif(x->>'partnerId', '')::uuid and p.organization_id = l.organization_id),
      left(trim(x->>'name'), 200), nullif(trim(coalesce(x->>'phone', '')), ''));
    v_realtor := true;
  end if;

  -- A lead moves to Contacted.
  if l.stage = 'lead' then
    update public.loans set stage = 'contacted' where id = v.loan_id;
    v_moved := true;
  end if;

  perform set_config('mps.intake_change', 'on', true);
  update public.intake_interviews set status = 'accepted', reviewed_at = now(), reviewed_by = auth.uid(), review_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  perform set_config('mps.intake_change', '', true);
  update public.action_items set status = 'approved', decided_by = auth.uid(), decided_at = now()
  where loan_id = v.loan_id and source = 'intake' and status = 'pending' and payload->>'intakeId' = p_id::text;

  select coalesce(nullif(trim(full_name), ''), email) into v_by from public.profiles where id = v.interviewer_user_id;
  if v_person is not null then
    insert into public.notes (organization_id, contact_id, loan_id, kind, body)
    values (l.organization_id, v_person, v.loan_id, 'note',
      'Intake interview' || coalesce(' by ' || v_by, '') || ' accepted. Added to the file where it was blank: '
      || n_jobs || ' job(s), ' || n_income || ' other income, ' || n_assets || ' account(s), ' || n_debts || ' debt(s)'
      || case when v_realtor then ', the realtor' else '' end || '.' || coalesce(' ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  end if;
  return jsonb_build_object('jobs', n_jobs, 'otherIncome', n_income, 'assets', n_assets, 'debts', n_debts, 'realtor', v_realtor, 'movedToContacted', v_moved);
end;
$$;

revoke all on function public.accept_intake(uuid, jsonb, text) from public, anon;
grant execute on function public.accept_intake(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Send it back with a question
-- ---------------------------------------------------------------------------

create or replace function public.return_intake(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v          public.intake_interviews%rowtype;
  v_lo       text;
  v_borrower text;
begin
  select * into v from public.intake_interviews where id = p_id;
  if v.id is null or coalesce(public.file_role(v.loan_id), '') not in ('lo', 'admin') then
    raise exception 'Only this file''s loan officer or an admin can send an intake back.';
  end if;
  if v.status <> 'submitted' then
    raise exception 'Only a submitted intake can be sent back.';
  end if;
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Write the question first.';
  end if;

  perform set_config('mps.intake_change', 'on', true);
  update public.intake_interviews set status = 'returned', reviewed_at = now(), reviewed_by = auth.uid(), review_note = trim(p_note) where id = p_id;
  perform set_config('mps.intake_change', '', true);
  update public.action_items set status = 'dismissed', decided_by = auth.uid(), decided_at = now()
  where loan_id = v.loan_id and source = 'intake' and status = 'pending' and payload->>'intakeId' = p_id::text;

  if v.interviewer_user_id is not null and v.interviewer_user_id <> auth.uid() then
    select coalesce(nullif(trim(display_name), ''), nullif(split_part(trim(coalesce(full_name, '')), ' ', 1), ''), email) into v_lo from public.profiles where id = auth.uid();
    select nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') into v_borrower
    from public.loan_borrowers lb join public.contacts c on c.id = lb.contact_id
    where lb.loan_id = v.loan_id order by (lb.role::text = 'primary') desc limit 1;
    insert into public.action_items (organization_id, loan_id, kind, title, payload, status, due_on, created_by, source, source_key)
    values (
      v.organization_id, v.loan_id, 'task_suggestion',
      left(coalesce(v_lo, 'The loan officer') || ' sent back the intake for ' || coalesce(v_borrower, 'a borrower'), 200),
      jsonb_build_object('title', left('Answer: ' || trim(p_note), 200), 'dueOn', (now() at time zone 'America/Chicago')::date,
        'forUserId', v.interviewer_user_id, 'intakeId', p_id),
      'pending', (now() at time zone 'America/Chicago')::date, auth.uid(), 'intake',
      'intake-return:' || p_id || ':' || extract(epoch from now())::bigint)
    on conflict (organization_id, source_key) do nothing;
    perform public.notify_user(v.organization_id, v.interviewer_user_id, 'intake_returned',
      coalesce(v_lo, 'The loan officer') || ' sent back an intake', left(coalesce(v_borrower || ': ', '') || trim(p_note), 500),
      '/loans/' || v.loan_id || '/intake', md5(p_id::text || clock_timestamp()::text)::uuid);
  end if;
end;
$$;

revoke all on function public.return_intake(uuid, text) from public, anon;
grant execute on function public.return_intake(uuid, text) to authenticated;

-- A resubmitted intake closes the interviewer's "sent back" item.
create or replace function public.intake_close_return_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' and old.status = 'returned' then
    update public.action_items set status = 'approved', decided_at = now()
    where loan_id = new.loan_id and source = 'intake' and status = 'pending'
      and payload->>'intakeId' = new.id::text and payload->>'forUserId' = new.interviewer_user_id::text;
  end if;
  return null;
end;
$$;

revoke all on function public.intake_close_return_items() from public, anon, authenticated;
drop trigger if exists intake_interviews_close_return on public.intake_interviews;
create trigger intake_interviews_close_return after update of status on public.intake_interviews
  for each row execute function public.intake_close_return_items();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ intake review installed' as result,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_intake_summary', 'accept_intake', 'return_intake', 'intake_close_return_items')) as functions,
  (select count(*) from pg_trigger where tgname = 'intake_interviews_close_return') as triggers;
