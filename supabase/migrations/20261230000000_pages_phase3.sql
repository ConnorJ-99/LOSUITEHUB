-- Pages, Phase 3 (Connor, 2026-11-07; docs/plans/pages.md): personal links
-- and your own templates.
--
-- 1. pages.status can be 'template': your own starter, private to you (and
--    admins), never public, copied into a new Draft when you use it.
-- 2. page_links: a personal link to a page for one person on one file
--    (/p/{slug}?t={code}). The code is long and random; the link fills in what
--    the file already has and ties the answers to that person, with no
--    matching. Links expire after 30 days and can be switched off.
-- 3. get_page_link(): what a personal link fills in (published pages only;
--    records when it was opened).
-- 4. record_page_submission() takes the link's code: the person and file are
--    known, so it adds a web-form row and a note instead of matching.
-- 5. A signed-in person's visit to a public page counts toward its views.
--
-- Safe to run more than once. A full run ends with one confirmation row.

-- ---------------------------------------------------------------------------
-- 1. Templates
-- ---------------------------------------------------------------------------

alter table public.pages drop constraint if exists pages_status_check;
alter table public.pages
  add constraint pages_status_check check (status in ('draft', 'published', 'archived', 'template'));

-- ---------------------------------------------------------------------------
-- 2. page_links
-- ---------------------------------------------------------------------------

create table if not exists public.page_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  page_id          uuid not null,
  contact_id       uuid not null,
  loan_id          uuid not null,
  -- 64 random letters and numbers (two random ids): the only thing in the link.
  token            text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') check (length(token) >= 32),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 days',
  last_opened_at   timestamptz,
  submitted_at     timestamptz,
  revoked_at       timestamptz,
  constraint page_links_token_key unique (token),
  constraint page_links_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- Deleting the page, the person or the file deletes their links.
  constraint page_links_page_id_fkey
    foreign key (page_id, organization_id) references public.pages (id, organization_id) on delete cascade,
  constraint page_links_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint page_links_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint page_links_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index if not exists page_links_loan_idx on public.page_links (loan_id, created_at desc);
create index if not exists page_links_page_idx on public.page_links (page_id);
create index if not exists page_links_contact_idx on public.page_links (contact_id);

-- The person is on the file and the page is published; afterwards a link can only be switched off.
create or replace function public.guard_page_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.loan_borrowers lb where lb.loan_id = new.loan_id and lb.contact_id = new.contact_id) then
      raise exception 'That person is not on this file.';
    end if;
    if not exists (select 1 from public.pages p where p.id = new.page_id and p.status = 'published') then
      raise exception 'Publish the page before sending a link to it.';
    end if;
  elsif auth.uid() is not null
    and (new.page_id, new.contact_id, new.loan_id, new.token, new.created_by, new.created_at, new.expires_at, new.last_opened_at, new.submitted_at)
        is distinct from (old.page_id, old.contact_id, old.loan_id, old.token, old.created_by, old.created_at, old.expires_at, old.last_opened_at, old.submitted_at) then
    raise exception 'A link can only be switched off.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_page_link() from public, anon, authenticated;

drop trigger if exists page_links_guard on public.page_links;
create trigger page_links_guard
  before insert or update on public.page_links
  for each row execute function public.guard_page_link();

alter table public.page_links enable row level security;

-- Whoever can see the file sees its links, and can send one from a page they can use.
drop policy if exists "page links: read" on public.page_links;
create policy "page links: read" on public.page_links
  for select to authenticated
  using (public.is_org_member(organization_id) and public.can_see_loan(loan_id));

drop policy if exists "page links: add" on public.page_links;
create policy "page links: add" on public.page_links
  for insert to authenticated
  with check (public.is_org_member(organization_id) and public.can_see_loan(loan_id) and public.can_see_page(page_id) and created_by = auth.uid());

drop policy if exists "page links: switch off" on public.page_links;
create policy "page links: switch off" on public.page_links
  for update to authenticated
  using (public.is_org_member(organization_id) and public.can_see_loan(loan_id))
  with check (public.is_org_member(organization_id) and public.can_see_loan(loan_id));

grant select, insert, update on public.page_links to authenticated;
revoke all on public.page_links from anon;

-- ---------------------------------------------------------------------------
-- 3. What a personal link fills in: the person's name, email and phone and
--    the file's figures, by the same keys a field can map to.
-- ---------------------------------------------------------------------------

create or replace function public.get_page_link(p_slug text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.page_links;
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val text;
begin
  select l.* into v_link
  from public.page_links l
  join public.pages p on p.id = l.page_id
  where l.token = p_token and p.slug = lower(trim(p_slug)) and p.status = 'published'
    and l.revoked_at is null and l.expires_at > now();
  if not found then
    return null;
  end if;
  update public.page_links set last_opened_at = now() where id = v_link.id;
  foreach v_key in array array['first_name', 'last_name', 'email', 'phone', 'purchase_price', 'loan_amount', 'cash_out', 'timeline'] loop
    v_val := public.page_field_current(v_link.contact_id, v_link.loan_id, v_key);
    if v_val <> '' then
      v_out := v_out || jsonb_build_object(v_key, v_val);
    end if;
  end loop;
  return jsonb_build_object('values', v_out, 'submitted', v_link.submitted_at is not null);
end;
$$;

revoke all on function public.get_page_link(text, text) from public;
grant execute on function public.get_page_link(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. One submission (personal links added; everything else as before).
-- ---------------------------------------------------------------------------

create or replace function public.record_page_submission(p_page_id uuid, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page      public.pages;
  v_sub_id    uuid := (p_sub->>'id')::uuid;
  v_mapped    jsonb := coalesce(p_sub->'mapped', '{}'::jsonb);
  v_ip        text := nullif(p_sub->>'ip_hash', '');
  v_owner_email text;
  v_tags      text[];
  v_kind      text;
  v_result    jsonb;
  v_outcome   text;
  v_contact   uuid;
  v_loan      uuid;
  v_partner   uuid;
  v_existing  record;
  v_proposed  jsonb := '[]'::jsonb;
  v_key       text;
  v_label     text;
  v_new       text;
  v_cur       text;
  v_price     numeric;
  v_token     text := nullif(p_sub->>'link_token', '');
  v_link      public.page_links;
  v_lead_sub  uuid;
begin
  select * into v_page from public.pages where id = p_page_id and status = 'published';
  if not found then
    raise exception 'page_not_found';
  end if;

  -- Sent twice (a double tap or a retry): answer as before.
  select id, contact_id, loan_id, outcome into v_existing from public.page_submissions where id = v_sub_id;
  if found then
    return jsonb_build_object('outcome', 'already_received', 'submission_id', v_existing.id, 'contact_id', v_existing.contact_id, 'loan_id', v_existing.loan_id, 'first_outcome', v_existing.outcome);
  end if;

  -- The spam limit: 5 submissions from one IP in 10 minutes, across all pages.
  if v_ip is not null and (
    select count(*) from public.page_submissions where ip_hash = v_ip and created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'rate_limited';
  end if;

  select p.email into v_owner_email from public.profiles p where p.id = v_page.owner_id;
  v_tags := array(select distinct t from (
    select v_page.title as t
    union all
    select trim(value) from jsonb_array_elements_text(case when jsonb_typeof(v_page.settings->'tags') = 'array' then v_page.settings->'tags' else '[]'::jsonb end)
  ) x where t <> '');
  v_kind := case when v_page.settings->>'leadKind' = 'partner' then 'partner' else 'lead' end;

  if v_token is not null then
    -- A personal link: the person and file are already known, so nothing is
    -- matched. A web-form row (so Today lists it) and a note on the person.
    select * into v_link from public.page_links
    where token = v_token and page_id = v_page.id and revoked_at is null and expires_at > now();
    if not found then
      raise exception 'link_invalid';
    end if;
    v_contact := v_link.contact_id;
    v_loan := v_link.loan_id;
    v_outcome := 'personal_link';
    insert into public.lead_submissions (organization_id, contact_id, loan_id, kind, form_type, source, external_id, tracking, answers, outcome)
    values (v_page.organization_id, v_contact, v_loan, 'lead', v_page.title, 'MPS-HQ page · personal link', 'page:' || v_sub_id::text,
      coalesce(p_sub->'source', '{}'::jsonb), coalesce(p_sub->'answers', '{}'::jsonb), 'existing_open_loan')
    returning id into v_lead_sub;
    insert into public.notes (organization_id, contact_id, loan_id, kind, body)
    values (v_page.organization_id, v_contact, v_loan, 'note', format('Filled out "%s" from a personal link. The answers are on the Overview.', v_page.title));
    update public.page_links set submitted_at = now() where id = v_link.id;
    v_result := jsonb_build_object('outcome', v_outcome, 'submission_id', v_lead_sub, 'contact_id', v_contact, 'loan_id', v_loan);
  else
  v_result := public.intake_web_lead(jsonb_build_object(
    'kind', v_kind,
    'first_name', v_mapped->>'first_name',
    'last_name', v_mapped->>'last_name',
    'email', v_mapped->>'email',
    'phone', v_mapped->>'phone',
    'purpose', v_mapped->>'purpose',
    'purchase_price', v_mapped->>'purchase_price',
    'down_payment', v_mapped->>'down_payment',
    'cash_out', v_mapped->>'cash_out',
    'credit_score', v_mapped->>'credit_score',
    'timeline', v_mapped->>'timeline',
    'sms_consent', coalesce(v_mapped->>'sms_consent', 'false'),
    'source', 'MPS-HQ page',
    'form_type', v_page.title,
    'assigned_to_email', v_owner_email,
    'external_id', 'page:' || v_sub_id::text,
    'tracking', coalesce(p_sub->'source', '{}'::jsonb),
    'answers', coalesce(p_sub->'answers', '{}'::jsonb)
  ));
  v_outcome := v_result->>'outcome';
  v_contact := nullif(v_result->>'contact_id', '')::uuid;
  v_loan := nullif(v_result->>'loan_id', '')::uuid;
  if v_outcome = 'partner_inquiry' then
    select partner_id into v_partner from public.lead_submissions where id = (v_result->>'submission_id')::uuid;
  end if;
  end if;

  -- A new lead is tagged by its referral source: "Page · {title}".
  if v_outcome in ('new_lead', 'new_loan_existing_person') and v_loan is not null then
    update public.loans set referral_source = left('Page · ' || v_page.title, 200) where id = v_loan;
  end if;

  -- Mapped answers: a brand-new lead takes the ones it has no value for;
  -- everything else that differs from the file waits for Accept / Reject.
  if v_contact is not null and v_loan is not null then
    -- The down payment is a loan amount on the file.
    if nullif(v_mapped->>'down_payment', '') is not null then
      v_price := coalesce(nullif(v_mapped->>'purchase_price', '')::numeric, nullif(public.page_field_current(v_contact, v_loan, 'purchase_price'), '')::numeric);
      if v_price is not null and (v_mapped->>'down_payment')::numeric < v_price then
        v_mapped := v_mapped || jsonb_build_object('loan_amount', (v_price - (v_mapped->>'down_payment')::numeric)::text);
      end if;
    end if;
    for v_key, v_label in
      select * from (values
        ('first_name', 'First name'), ('last_name', 'Last name'), ('email', 'Email'), ('phone', 'Phone'),
        ('purpose', 'Loan purpose'), ('purchase_price', 'Purchase price'), ('loan_amount', 'Loan amount'),
        ('cash_out', 'Cash-out amount'), ('credit_score', 'Estimated credit score'), ('timeline', 'Timeline'),
        ('income_doc_type', 'Income type')
      ) as f(k, l)
    loop
      v_new := nullif(trim(coalesce(v_mapped->>v_key, '')), '');
      continue when v_new is null;
      if v_key = 'email' then v_new := lower(v_new); end if;
      if v_key = 'phone' then v_new := right(regexp_replace(v_new, '\D', '', 'g'), 10); end if;
      v_cur := public.page_field_current(v_contact, v_loan, v_key);
      continue when v_cur = v_new
        or (v_key in ('purchase_price', 'loan_amount', 'cash_out', 'credit_score') and v_cur <> '' and v_cur::numeric = v_new::numeric);
      -- Blank on a file this submission just started (a new person, or a
      -- past client's new file for its loan fields) = nothing to overwrite.
      if v_cur = '' and (v_outcome = 'new_lead'
        or (v_outcome = 'new_loan_existing_person' and v_key not in ('first_name', 'last_name', 'email', 'phone'))) then
        perform public.page_field_apply(v_contact, v_loan, v_key, v_new);
      else
        v_proposed := v_proposed || jsonb_build_array(jsonb_build_object('key', v_key, 'label', v_label, 'value', v_new, 'current', nullif(v_cur, ''), 'status', 'pending'));
      end if;
    end loop;
  end if;

  insert into public.page_submissions (id, organization_id, page_id, data, files, contact_id, loan_id, partner_id, outcome, lead_submission_id, source, tags, ip_hash, proposed)
  values (
    v_sub_id, v_page.organization_id, v_page.id,
    coalesce(p_sub->'data', '[]'::jsonb), coalesce(p_sub->'files', '[]'::jsonb),
    v_contact, v_loan, v_partner, v_outcome, nullif(v_result->>'submission_id', '')::uuid,
    coalesce(p_sub->'source', '{}'::jsonb), v_tags, v_ip, v_proposed
  );

  return jsonb_build_object('outcome', v_outcome, 'submission_id', v_sub_id, 'contact_id', v_contact, 'loan_id', v_loan, 'partner_id', v_partner,
    'organization_id', v_page.organization_id, 'owner_id', v_page.owner_id, 'proposed', jsonb_array_length(v_proposed));
end;
$$;

revoke all on function public.record_page_submission(uuid, jsonb) from public;
do $$ begin
  revoke all on function public.record_page_submission(uuid, jsonb) from anon, authenticated;
exception when undefined_object then null;
end $$;
do $$ begin
  grant execute on function public.record_page_submission(uuid, jsonb) to service_role;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. View counts: a signed-in person opening a public page (Connor checking
--    his own page) is counted like anyone else. The guard that stops people
--    changing a page's view count by hand now lets get_public_page() through.
-- ---------------------------------------------------------------------------

create or replace function public.guard_page()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block jsonb;
begin
  for v_block in select value from jsonb_array_elements(new.blocks) loop
    if v_block->>'type' in ('ssn', 'dob', 'date_of_birth', 'social_security') then
      raise exception 'Pages can''t ask for a Social Security number or date of birth.';
    end if;
    if coalesce(v_block->>'label', '') ~* '(social\s*security|\mssn\M|\msocial\M.*\mnumber\M|date\s+of\s+birth|\mdob\M|birth\s*date)' then
      raise exception 'Pages can''t ask for a Social Security number or date of birth ("%").', left(v_block->>'label', 60);
    end if;
  end loop;
  if new.owner_id is not null and not exists (
    select 1 from public.organization_members m where m.organization_id = new.organization_id and m.user_id = new.owner_id
  ) then
    raise exception 'The page owner must be on the team.';
  end if;
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and auth.uid() is not null
    and not public.sees_all_files(new.organization_id) then
    raise exception 'Only an admin can hand a page to someone else.';
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
  end if;
  -- Only get_public_page() counts views (it sets mps.counting_view for its own update).
  if tg_op = 'UPDATE' and new.view_count is distinct from old.view_count and auth.uid() is not null
    and coalesce(current_setting('mps.counting_view', true), '') <> 'on' then
    new.view_count := old.view_count;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_page() from public, anon, authenticated;

create or replace function public.get_public_page(p_slug text, p_count_view boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.pages;
  v_owner jsonb;
  v_org jsonb;
  v_photo text;
  v_agent jsonb;
begin
  select * into v_page from public.pages where slug = lower(trim(p_slug)) and status = 'published';
  if not found then
    return null;
  end if;

  if p_count_view then
    perform set_config('mps.counting_view', 'on', true);
    update public.pages set view_count = view_count + 1 where id = v_page.id;
    perform set_config('mps.counting_view', '', true);
    insert into public.page_view_days (page_id, day, views)
    values (v_page.id, (now() at time zone 'America/Chicago')::date, 1)
    on conflict (page_id, day) do update set views = public.page_view_days.views + 1;
  end if;

  if v_page.owner_id is not null then
    select o.name into v_photo
    from storage.objects o
    where o.bucket_id = 'page-assets' and o.name like v_page.organization_id::text || '/headshots/' || v_page.owner_id::text || '.%'
    order by o.name
    limit 1;
    -- to_jsonb so a profile column that isn't there yet reads as null.
    select jsonb_build_object(
      'name', p.full_name,
      'nmls', p.nmls,
      'phone', coalesce(nullif(to_jsonb(p)->>'personal_cell', ''), p.phone),
      'email', p.email,
      'bookingUrl', to_jsonb(p)->>'booking_url',
      'photoPath', v_photo
    ) into v_owner
    from public.profiles p where p.id = v_page.owner_id;
  end if;

  -- Open houses: the listing agent from Partners (the partner record is the source).
  if v_page.type = 'open_house' and coalesce(v_page.property->>'agentPartnerId', '') ~ '^[0-9a-f-]{36}$' then
    select jsonb_build_object('name', pa.name, 'company', pa.company, 'phone', pa.phone, 'email', pa.email) into v_agent
    from public.partners pa
    where pa.id = (v_page.property->>'agentPartnerId')::uuid and pa.organization_id = v_page.organization_id;
  end if;

  select jsonb_build_object('name', o.name, 'nmls', coalesce(o.nmls, '2501110')) into v_org
  from public.organizations o where o.id = v_page.organization_id;

  return jsonb_build_object(
    'id', v_page.id,
    'type', v_page.type,
    'title', v_page.title,
    'slug', v_page.slug,
    'blocks', v_page.blocks,
    'settings', v_page.settings - 'tags' - 'notify' - 'leadKind',
    'property', v_page.property,
    'owner', v_owner,
    'agent', v_agent,
    'company', v_org
  );
end;
$$;

revoke all on function public.get_public_page(text, boolean) from public;
grant execute on function public.get_public_page(text, boolean) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ pages phase 3 installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'page_links') as links_table,
  (select count(*) from pg_constraint where conname = 'pages_status_check' and pg_get_constraintdef(oid) like '%template%') as template_status,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and ((proname = 'record_page_submission' and prosrc like '%link_invalid%') or proname = 'get_page_link' or (proname = 'get_public_page' and prosrc like '%counting_view%'))) as functions;
