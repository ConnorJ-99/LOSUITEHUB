-- Launch: what the live mps.mortgage forms send (checked 2026-11-02).
--
-- 1. Text consent from the website. Most forms have an optional "text me"
--    box. When it's checked, the person's sms_consent is turned on and a
--    consent_events row says it came from the web form. Someone who opted out
--    (STOP or GHL Do Not Disturb) stays opted out; only "Restore" with a note
--    turns them back on. Partner forms do the same for the partner.
-- 2. The multi-step form posts again after each step with the same lead_id
--    (lead-intake passes it as form_lead_id). A later step for a file that's
--    still open no longer adds a note and a task each time: it is saved as
--    outcome 'form_update' (already marked handled, so Today shows the form
--    once), and it only fills blanks on the file (price, loan amount, cash
--    out, timeline, estimated credit score). Nothing is overwritten.
--
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite launch intake installed").

alter table public.lead_submissions add column if not exists form_lead_id text;
create index if not exists lead_submissions_form_lead_id_idx on public.lead_submissions (organization_id, form_lead_id) where form_lead_id is not null;

alter table public.lead_submissions drop constraint if exists lead_submissions_outcome_check;
alter table public.lead_submissions
  add constraint lead_submissions_outcome_check check (outcome in ('new_lead', 'existing_open_loan', 'new_loan_existing_person', 'partner_inquiry', 'form_update'));

alter table public.consent_events drop constraint if exists consent_events_source_check;
alter table public.consent_events
  add constraint consent_events_source_check check (source in ('stop_reply', 'ghl_dnd', 'person', 'web_form'));

-- intake_web_lead as in 20261210000000_partners.sql, plus consent and form steps.
create or replace function public.intake_web_lead(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     text := coalesce(nullif(p_lead->>'kind', ''), 'lead');
  v_email    text := nullif(lower(trim(coalesce(p_lead->>'email', ''))), '');
  v_phone    text := nullif(right(regexp_replace(coalesce(p_lead->>'phone', ''), '\D', '', 'g'), 10), '');
  v_ext      text := nullif(trim(coalesce(p_lead->>'external_id', '')), '');
  v_step_id  text := nullif(trim(coalesce(p_lead->>'form_lead_id', '')), '');
  v_texts_ok boolean := coalesce(p_lead->>'sms_consent', '') = 'true';
  v_first    text := coalesce(nullif(trim(coalesce(p_lead->>'first_name', '')), ''), 'Web lead');
  v_purpose  public.loan_purpose := coalesce(nullif(p_lead->>'purpose', ''), 'purchase')::public.loan_purpose;
  v_price    numeric := nullif(p_lead->>'purchase_price', '')::numeric;
  v_down     numeric := nullif(p_lead->>'down_payment', '')::numeric;
  v_cash_out numeric := nullif(p_lead->>'cash_out', '')::numeric;
  v_credit   smallint := nullif(p_lead->>'credit_score', '')::smallint;
  v_timeline text := nullif(left(coalesce(p_lead->>'timeline', ''), 200), '');
  v_source   text := left(concat_ws(' · ', nullif(p_lead->>'source', ''), nullif(p_lead->>'form_type', '')), 200);
  v_org      uuid;
  v_lo       uuid;
  v_contact  uuid;
  v_loan     uuid;
  v_prior    uuid;
  v_outcome  text;
  v_existing record;
  v_sub      uuid;
  v_partner  uuid;
begin
  if v_email is null and (v_phone is null or length(v_phone) < 10) then
    raise exception 'An email or phone number is required.';
  end if;
  if v_kind not in ('lead', 'partner') then
    raise exception 'Unknown kind: %', v_kind;
  end if;

  -- Who it's for: the named loan officer, otherwise the company owner.
  select m.user_id, m.organization_id into v_lo, v_org
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where nullif(p_lead->>'assigned_to_email', '') is not null
    and lower(p.email) = lower(p_lead->>'assigned_to_email')
  order by m.created_at
  limit 1;
  if v_org is null then
    select m.user_id, m.organization_id into v_lo, v_org
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.role = 'owner'
    order by o.created_at, m.created_at
    limit 1;
  end if;
  if v_org is null then
    raise exception 'No company is set up to receive leads.';
  end if;

  -- The same submission sent again: answer as before, save nothing.
  if v_ext is not null then
    select id, contact_id, loan_id, outcome into v_existing
    from public.lead_submissions
    where organization_id = v_org and external_id = v_ext;
    if found then
      return jsonb_build_object('outcome', 'already_received', 'first_outcome', v_existing.outcome, 'submission_id', v_existing.id, 'contact_id', v_existing.contact_id, 'loan_id', v_existing.loan_id);
    end if;
  end if;

  if v_kind = 'partner' then
    v_partner := public.partner_from_submission(v_org, p_lead->>'form_type', p_lead->'answers', p_lead->>'first_name', p_lead->>'last_name', v_email, v_phone);
    if v_texts_ok and v_partner is not null then
      update public.partners set sms_consent = true
      where id = v_partner and sms_opted_out_at is null and sms_consent is distinct from true;
    end if;
    insert into public.lead_submissions (organization_id, partner_id, kind, form_type, source, external_id, form_lead_id, tracking, answers, outcome)
    values (v_org, v_partner, 'partner', p_lead->>'form_type', v_source, v_ext, v_step_id, coalesce(p_lead->'tracking', '{}'::jsonb), coalesce(p_lead->'answers', '{}'::jsonb), 'partner_inquiry')
    returning id into v_sub;
    return jsonb_build_object('outcome', 'partner_inquiry', 'submission_id', v_sub);
  end if;

  -- A later step of the same multi-step form, for a file that's still open.
  if v_step_id is not null then
    select s.contact_id, s.loan_id into v_existing
    from public.lead_submissions s
    join public.loans l on l.id = s.loan_id
    where s.organization_id = v_org and s.form_lead_id = v_step_id and s.kind = 'lead'
      and l.stage not in ('closed', 'lost')
    order by s.received_at
    limit 1;
    if found then
      v_contact := v_existing.contact_id;
      v_loan := v_existing.loan_id;
      v_outcome := 'form_update';
      update public.loans l set
        purchase_price = coalesce(l.purchase_price, case when l.purpose = 'purchase' then v_price end),
        loan_amount = coalesce(l.loan_amount, case
          when l.purpose = 'purchase' and coalesce(l.purchase_price, v_price) is not null and v_down is not null and v_down < coalesce(l.purchase_price, v_price)
          then coalesce(l.purchase_price, v_price) - v_down end),
        cash_out_amount = coalesce(l.cash_out_amount, case when l.purpose = 'refinance_cash_out' then v_cash_out end),
        timeline = coalesce(l.timeline, v_timeline)
      where l.id = v_loan
        and (l.purchase_price is null or l.loan_amount is null or l.cash_out_amount is null or l.timeline is null);
      if v_credit is not null then
        update public.loan_borrowers set estimated_credit_score = v_credit
        where loan_id = v_loan and role = 'primary' and estimated_credit_score is null;
      end if;
    end if;
  end if;

  if v_outcome is null then
    -- Same person: same email or same 10-digit phone.
    select c.id into v_contact
    from public.contacts c
    where c.organization_id = v_org
      and ((v_email is not null and lower(c.email) = v_email) or (v_phone is not null and right(c.phone_digits, 10) = v_phone))
    order by c.updated_at desc
    limit 1;

    if v_contact is not null then
      select l.id, l.assigned_lo_id into v_existing
      from public.loans l
      join public.loan_borrowers lb on lb.loan_id = l.id
      where lb.contact_id = v_contact and l.stage not in ('closed', 'lost')
      order by l.created_at desc
      limit 1;
      if found then
        v_loan := v_existing.id;
        v_outcome := 'existing_open_loan';
        insert into public.notes (organization_id, contact_id, loan_id, kind, body)
        values (v_org, v_contact, v_loan, 'note', format('New web form: %s. Answers are on the Overview under Web forms.', coalesce(v_source, 'website')));
        insert into public.tasks (organization_id, loan_id, title, due_on, assigned_to)
        values (v_org, v_loan, format('Follow up on a new web form from %s', v_first), current_date, coalesce(v_existing.assigned_lo_id, v_lo));
      else
        select l.id into v_prior
        from public.loans l
        join public.loan_borrowers lb on lb.loan_id = l.id
        where lb.contact_id = v_contact
        order by l.created_at desc
        limit 1;
        v_outcome := 'new_loan_existing_person';
      end if;
    else
      insert into public.contacts (organization_id, first_name, last_name, email, phone)
      values (v_org, left(v_first, 100), left(coalesce(trim(p_lead->>'last_name'), ''), 100), v_email, v_phone)
      returning id into v_contact;
      v_outcome := 'new_lead';
    end if;

    if v_loan is null then
      insert into public.loans (organization_id, purpose, referral_source, assigned_lo_id, prior_loan_id, purchase_price, loan_amount, cash_out_amount, timeline)
      values (
        v_org,
        v_purpose,
        v_source,
        v_lo,
        v_prior,
        case when v_purpose = 'purchase' then v_price end,
        case when v_purpose = 'purchase' and v_price is not null and v_down is not null and v_down < v_price then v_price - v_down end,
        case when v_purpose = 'refinance_cash_out' then v_cash_out end,
        v_timeline
      )
      returning id into v_loan;
      insert into public.loan_borrowers (loan_id, contact_id, organization_id, role, estimated_credit_score)
      values (v_loan, v_contact, v_org, 'primary', v_credit);
    end if;
  end if;

  -- The "text me" box. An opt-out always wins.
  if v_texts_ok and v_contact is not null then
    update public.contacts set sms_consent = true
    where id = v_contact and sms_opted_out_at is null and sms_consent is distinct from true;
    if found then
      insert into public.consent_events (organization_id, contact_id, channel, change, source, note)
      values (v_org, v_contact, 'text', 'granted', 'web_form', format('Checked the text consent box on the website (%s).', coalesce(nullif(p_lead->>'form_type', ''), 'web form')));
    end if;
  end if;

  insert into public.lead_submissions (organization_id, contact_id, loan_id, kind, form_type, source, external_id, form_lead_id, tracking, answers, outcome, handled_at)
  values (v_org, v_contact, v_loan, 'lead', p_lead->>'form_type', v_source, v_ext, v_step_id, coalesce(p_lead->'tracking', '{}'::jsonb), coalesce(p_lead->'answers', '{}'::jsonb), v_outcome,
    case when v_outcome = 'form_update' then now() end)
  returning id into v_sub;

  return jsonb_build_object('outcome', v_outcome, 'submission_id', v_sub, 'contact_id', v_contact, 'loan_id', v_loan);
end;
$$;

-- Only the intake Edge Function (service role) may run it.
revoke all on function public.intake_web_lead(jsonb) from public;
do $$ begin
  revoke all on function public.intake_web_lead(jsonb) from anon, authenticated;
exception when undefined_object then null;
end $$;
do $$ begin
  grant execute on function public.intake_web_lead(jsonb) to service_role;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite launch intake installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'lead_submissions' and column_name = 'form_lead_id') as form_lead_id_column,
  (select count(*) from pg_constraint where conname = 'lead_submissions_outcome_check' and pg_get_constraintdef(oid) like '%form_update%') as form_update_outcome,
  (select count(*) from pg_constraint where conname = 'consent_events_source_check' and pg_get_constraintdef(oid) like '%web_form%') as web_form_consent,
  (select count(*) from pg_proc where proname = 'intake_web_lead' and pronamespace = 'public'::regnamespace and prosrc like '%form_update%') as intake_updated;
