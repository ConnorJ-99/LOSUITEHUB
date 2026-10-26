-- LOSuite: lead intake from mps.mortgage, part 5a.
--
-- lead_submissions keeps every web form submission (all answers, source and
-- tracking, minus anything sensitive, which the intake function strips
-- first). intake_web_lead() applies the duplicate rules:
--   - a new person: new contact and a new Lead
--   - someone with an open file: the submission is attached to that file,
--     with a note and a task; nothing on the file is overwritten
--   - someone whose earlier loans are closed or lost: a new Lead on the same
--     person, linked to their latest loan
--   - the same submission sent twice (same external id): saved once
--   - partner/realtor inquiries: saved for follow-up, no lead created
-- Leads go to the loan officer named by assigned_to_email, otherwise to the
-- company owner. Only the intake Edge Function (service role) can run it.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite lead intake installed").

create table if not exists public.lead_submissions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  -- Who and which file it went to. Deleting either keeps the submission.
  contact_id       uuid,
  loan_id          uuid,
  kind             text not null default 'lead' check (kind in ('lead', 'partner')),
  form_type        text,
  source           text,
  -- The website's own id for the submission, so a re-send isn't saved twice.
  external_id      text,
  -- utm_source, utm_campaign, referrer...
  tracking         jsonb not null default '{}'::jsonb check (jsonb_typeof(tracking) = 'object'),
  -- Every answer from the form (sensitive fields already removed).
  answers          jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  outcome          text not null check (outcome in ('new_lead', 'existing_open_loan', 'new_loan_existing_person', 'partner_inquiry')),
  received_at      timestamptz not null default now(),
  constraint lead_submissions_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint lead_submissions_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id),
  constraint lead_submissions_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id),
  constraint lead_submissions_external_id_unique unique (organization_id, external_id)
);

create index if not exists lead_submissions_contact_id_idx on public.lead_submissions (contact_id, received_at desc);
create index if not exists lead_submissions_loan_id_idx on public.lead_submissions (loan_id);

alter table public.lead_submissions enable row level security;

-- Visible with the file or person it belongs to; partner inquiries to everyone in the company.
drop policy if exists "members see submissions they may see" on public.lead_submissions;
create policy "members see submissions they may see" on public.lead_submissions
  for select to authenticated using (
    case
      when loan_id is not null then public.can_see_loan(loan_id)
      when contact_id is not null then public.can_see_contact(contact_id)
      else public.is_org_member(organization_id)
    end
  );
-- No insert, update or delete policies: only intake_web_lead() writes here, and the record is kept.

-- ---------------------------------------------------------------------------
-- intake_web_lead: one cleaned-up submission in, the outcome out
-- ---------------------------------------------------------------------------

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
  v_first    text := coalesce(nullif(trim(coalesce(p_lead->>'first_name', '')), ''), 'Web lead');
  v_purpose  public.loan_purpose := coalesce(nullif(p_lead->>'purpose', ''), 'purchase')::public.loan_purpose;
  v_price    numeric := nullif(p_lead->>'purchase_price', '')::numeric;
  v_down     numeric := nullif(p_lead->>'down_payment', '')::numeric;
  v_source   text := left(concat_ws(' · ', nullif(p_lead->>'source', ''), nullif(p_lead->>'form_type', '')), 200);
  v_org      uuid;
  v_lo       uuid;
  v_contact  uuid;
  v_loan     uuid;
  v_prior    uuid;
  v_outcome  text;
  v_existing record;
  v_sub      uuid;
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
    insert into public.lead_submissions (organization_id, kind, form_type, source, external_id, tracking, answers, outcome)
    values (v_org, 'partner', p_lead->>'form_type', v_source, v_ext, coalesce(p_lead->'tracking', '{}'::jsonb), coalesce(p_lead->'answers', '{}'::jsonb), 'partner_inquiry')
    returning id into v_sub;
    return jsonb_build_object('outcome', 'partner_inquiry', 'submission_id', v_sub);
  end if;

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
      case when v_purpose = 'refinance_cash_out' then nullif(p_lead->>'cash_out', '')::numeric end,
      nullif(left(coalesce(p_lead->>'timeline', ''), 200), '')
    )
    returning id into v_loan;
    insert into public.loan_borrowers (loan_id, contact_id, organization_id, role, estimated_credit_score)
    values (v_loan, v_contact, v_org, 'primary', nullif(p_lead->>'credit_score', '')::smallint);
  end if;

  insert into public.lead_submissions (organization_id, contact_id, loan_id, kind, form_type, source, external_id, tracking, answers, outcome)
  values (v_org, v_contact, v_loan, 'lead', p_lead->>'form_type', v_source, v_ext, coalesce(p_lead->'tracking', '{}'::jsonb), coalesce(p_lead->'answers', '{}'::jsonb), v_outcome)
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
  'LOSuite lead intake installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from pg_proc where proname = 'intake_web_lead') as intake_function;
