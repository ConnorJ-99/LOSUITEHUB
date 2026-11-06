-- Pages, Phase 1 (Connor, 2026-11-06; plan in docs/plans/pages.md).
-- Quick forms, landing pages and open house sites at /p/{slug}. Every
-- submission runs through the website's own intake_web_lead(), so it is
-- matched by email or phone, becomes a lead or a note on the open file, and
-- shows in Today's web forms like any website lead.
--
-- 1. pages: one row per page (owner, type, title, slug, Draft/Published,
--    blocks, settings, property for open houses, view count).
-- 2. page_submissions: one row per submission (answers, files, the person and
--    file it went to, UTM, a one-way IP code for the spam limit, proposed
--    updates). Written only by the page-submit Edge Function (service role).
-- 3. page_view_days: views per page per day (no visitor details).
-- 4. Storage: page-assets (public: page images, headshots) and page-uploads
--    (private: visitors' files).
-- 5. get_public_page(): what a visitor's browser loads (published only).
-- 6. record_page_submission(): the intake, proposed updates and the row,
--    service role only.
-- 7. decide_page_update(): Accept / Reject one proposed update.
-- 8. A "page_submission" notification for the page owner.
--
-- Safe to run more than once. A full run ends with one confirmation row.

-- ---------------------------------------------------------------------------
-- 1. pages
-- ---------------------------------------------------------------------------

create table if not exists public.pages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  owner_id         uuid default auth.uid(),
  type             text not null default 'form' check (type in ('form', 'landing', 'open_house')),
  title            text not null check (length(trim(title)) > 0 and length(title) <= 200),
  -- The web address: /p/{slug}. Lowercase letters, numbers and dashes.
  slug             text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  status           text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- The page's content, in order: [{"id": "...", "type": "heading", ...}, ...].
  blocks           jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  -- {"successMessage", "redirectUrl", "tags", "notify", "seoTitle", "seoDescription", "ogImage", "submitLabel", "consent", "leadKind"}.
  settings         jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  -- Open houses (Phase 2): address, price, photos, details.
  property         jsonb check (property is null or jsonb_typeof(property) = 'object'),
  view_count       integer not null default 0 check (view_count >= 0),
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pages_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- An owner who leaves keeps their pages on file, unowned (an admin reassigns them).
  constraint pages_owner_id_fkey
    foreign key (owner_id) references public.profiles (id) on delete set null,
  -- One address per page across MPS-HQ (the address has no company in it).
  constraint pages_slug_key unique (slug),
  constraint pages_id_organization_id_key unique (id, organization_id)
);

create index if not exists pages_owner_idx on public.pages (organization_id, owner_id, updated_at desc);

drop trigger if exists pages_set_updated_at on public.pages;
create trigger pages_set_updated_at
  before update on public.pages
  for each row execute function public.set_updated_at();

-- No SSN or date-of-birth questions, by type or by label; the owner is on the
-- team; only an admin hands a page to someone else; publishing stamps the date.
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
  if tg_op = 'UPDATE' and new.view_count is distinct from old.view_count and auth.uid() is not null then
    new.view_count := old.view_count;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_page() from public, anon, authenticated;

drop trigger if exists pages_guard on public.pages;
create trigger pages_guard
  before insert or update on public.pages
  for each row execute function public.guard_page();

alter table public.pages enable row level security;

-- Anyone may read a published page (the public page itself loads through
-- get_public_page, below).
drop policy if exists "pages: published to anyone" on public.pages;
create policy "pages: published to anyone" on public.pages
  for select to anon
  using (status = 'published');

-- Signed in: your own pages; the admin role sees every page.
drop policy if exists "pages: read your own" on public.pages;
create policy "pages: read your own" on public.pages
  for select to authenticated
  using (public.is_org_member(organization_id) and (owner_id = auth.uid() or public.sees_all_files(organization_id)));

drop policy if exists "pages: add" on public.pages;
create policy "pages: add" on public.pages
  for insert to authenticated
  with check (public.is_org_member(organization_id) and (owner_id = auth.uid() or public.sees_all_files(organization_id)));

drop policy if exists "pages: change your own" on public.pages;
create policy "pages: change your own" on public.pages
  for update to authenticated
  using (public.is_org_member(organization_id) and (owner_id = auth.uid() or public.sees_all_files(organization_id)))
  with check (public.is_org_member(organization_id) and (owner_id = auth.uid() or public.sees_all_files(organization_id)));

-- A page with submissions can't be deleted (archive it instead).
drop policy if exists "pages: delete your own" on public.pages;
create policy "pages: delete your own" on public.pages
  for delete to authenticated
  using (public.is_org_member(organization_id) and (owner_id = auth.uid() or public.sees_all_files(organization_id)));

grant select, insert, update, delete on public.pages to authenticated;
revoke all on public.pages from anon;
grant select on public.pages to anon;

-- ---------------------------------------------------------------------------
-- 2. page_submissions
-- ---------------------------------------------------------------------------

create table if not exists public.page_submissions (
  -- Made by the visitor's browser when the form opens, so uploads can go
  -- under it and a re-send is saved once.
  id                  uuid primary key,
  organization_id     uuid not null,
  page_id             uuid not null,
  -- Every answer, by question: [{"blockId", "label", "type", "value"}].
  data                jsonb not null default '[]'::jsonb check (jsonb_typeof(data) = 'array'),
  -- [{"blockId", "name", "path", "size", "type"}] in the page-uploads bucket.
  files               jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  -- The person and file it matched or created.
  contact_id          uuid,
  loan_id             uuid,
  partner_id          uuid,
  -- intake_web_lead's outcome: new_lead, existing_open_loan, new_loan_existing_person, partner_inquiry, form_update.
  outcome             text not null,
  lead_submission_id  uuid,
  -- utm_source, utm_medium, utm_campaign, referrer.
  source              jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  tags                text[] not null default '{}',
  -- A one-way code made from the visitor's IP (never the IP itself), for the spam limit.
  ip_hash             text,
  -- Answers mapped to the file that weren't written: [{"key", "label", "value", "current", "status", "decidedBy", "decidedAt"}].
  proposed            jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed) = 'array'),
  -- What happened in GHL: linked, created, skipped (test mode) or the problem.
  ghl_result          text,
  created_at          timestamptz not null default now(),
  constraint page_submissions_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- Submissions are kept: a page that has them can't be deleted, only archived.
  constraint page_submissions_page_id_fkey
    foreign key (page_id, organization_id) references public.pages (id, organization_id) on delete no action,
  constraint page_submissions_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id),
  constraint page_submissions_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id),
  constraint page_submissions_partner_id_fkey
    foreign key (partner_id, organization_id) references public.partners (id, organization_id) on delete set null (partner_id),
  constraint page_submissions_lead_submission_id_fkey
    foreign key (lead_submission_id) references public.lead_submissions (id) on delete set null
);

create index if not exists page_submissions_page_idx on public.page_submissions (page_id, created_at desc);
create index if not exists page_submissions_loan_idx on public.page_submissions (loan_id);
create index if not exists page_submissions_contact_idx on public.page_submissions (contact_id);
create index if not exists page_submissions_lead_submission_idx on public.page_submissions (lead_submission_id);
create index if not exists page_submissions_ip_idx on public.page_submissions (ip_hash, created_at desc);

alter table public.page_submissions enable row level security;

-- Who sees a submission: the page's owner, the admin role, and whoever can see the file it went to.
create or replace function public.can_see_page(p_page uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pages p
    where p.id = p_page
      and public.is_org_member(p.organization_id)
      and (p.owner_id = auth.uid() or public.sees_all_files(p.organization_id))
  );
$$;

revoke all on function public.can_see_page(uuid) from public, anon;
grant execute on function public.can_see_page(uuid) to authenticated;

drop policy if exists "page submissions: read" on public.page_submissions;
create policy "page submissions: read" on public.page_submissions
  for select to authenticated
  using (public.can_see_page(page_id) or (loan_id is not null and public.can_see_loan(loan_id)));

-- No insert, update or delete from the app: page-submit writes them and
-- decide_page_update() records Accept / Reject.
grant select on public.page_submissions to authenticated;
revoke all on public.page_submissions from anon;

-- ---------------------------------------------------------------------------
-- 3. page_view_days
-- ---------------------------------------------------------------------------

create table if not exists public.page_view_days (
  page_id  uuid not null,
  day      date not null,
  views    integer not null default 0 check (views >= 0),
  primary key (page_id, day),
  constraint page_view_days_page_id_fkey
    foreign key (page_id) references public.pages (id) on delete cascade
);

alter table public.page_view_days enable row level security;

drop policy if exists "page views: read" on public.page_view_days;
create policy "page views: read" on public.page_view_days
  for select to authenticated
  using (public.can_see_page(page_id));

grant select on public.page_view_days to authenticated;
revoke all on public.page_view_days from anon;

-- ---------------------------------------------------------------------------
-- 4. Storage. page-assets is public (visitors aren't signed in): images on
--    pages and the owner's headshot, at <company>/... . page-uploads is
--    private: visitors' files at <company>/<page>/<submission>/<file>, put
--    there through one-time links from page-submit.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('page-assets', 'page-assets', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('page-uploads', 'page-uploads', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The company a storage path starts with, or null.
create or replace function public.page_file_org(path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(path, '/', 1)::uuid end;
$$;

-- A visitor's file: whoever can see its submission.
create or replace function public.can_open_page_upload(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(path, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.page_submissions s
      where s.id = split_part(path, '/', 3)::uuid
        and s.organization_id = public.page_file_org(path)
        and (public.can_see_page(s.page_id) or (s.loan_id is not null and public.can_see_loan(s.loan_id)))
    );
$$;

revoke all on function public.page_file_org(text) from public, anon;
grant execute on function public.page_file_org(text) to authenticated;
revoke all on function public.can_open_page_upload(text) from public, anon;
grant execute on function public.can_open_page_upload(text) to authenticated;

drop policy if exists "mps hq members read page assets" on storage.objects;
create policy "mps hq members read page assets" on storage.objects
  for select to authenticated using (bucket_id = 'page-assets' and public.is_org_member(public.page_file_org(name)));
drop policy if exists "mps hq members add page assets" on storage.objects;
create policy "mps hq members add page assets" on storage.objects
  for insert to authenticated with check (bucket_id = 'page-assets' and public.is_org_member(public.page_file_org(name)));
drop policy if exists "mps hq members replace page assets" on storage.objects;
create policy "mps hq members replace page assets" on storage.objects
  for update to authenticated using (bucket_id = 'page-assets' and public.is_org_member(public.page_file_org(name)));
drop policy if exists "mps hq members remove page assets" on storage.objects;
create policy "mps hq members remove page assets" on storage.objects
  for delete to authenticated using (bucket_id = 'page-assets' and public.is_org_member(public.page_file_org(name)));

drop policy if exists "mps hq read page uploads" on storage.objects;
create policy "mps hq read page uploads" on storage.objects
  for select to authenticated using (bucket_id = 'page-uploads' and public.can_open_page_upload(name));

-- ---------------------------------------------------------------------------
-- 5. What a visitor's browser loads: a published page, its owner's card and
--    the company line. Counts the view unless p_count_view is false (the
--    builder's preview).
-- ---------------------------------------------------------------------------

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
begin
  select * into v_page from public.pages where slug = lower(trim(p_slug)) and status = 'published';
  if not found then
    return null;
  end if;

  if p_count_view then
    update public.pages set view_count = view_count + 1 where id = v_page.id;
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
    'company', v_org
  );
end;
$$;

revoke all on function public.get_public_page(text, boolean) from public;
grant execute on function public.get_public_page(text, boolean) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. One submission, run by the page-submit Edge Function only.
--    p_sub: {"id", "data", "files", "mapped": {"first_name", "last_name",
--    "email", "phone", "purpose", "purchase_price", "down_payment",
--    "cash_out", "credit_score", "timeline", "income_doc_type",
--    "sms_consent"}, "answers", "source", "ip_hash"}.
-- ---------------------------------------------------------------------------

-- The file's value for a mapped field, as text ('' when blank).
create or replace function public.page_field_current(p_contact uuid, p_loan uuid, p_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  case p_key
    when 'first_name' then select first_name into v from public.contacts where id = p_contact;
    when 'last_name' then select last_name into v from public.contacts where id = p_contact;
    when 'email' then select lower(email) into v from public.contacts where id = p_contact;
    when 'phone' then select right(phone_digits, 10) into v from public.contacts where id = p_contact;
    when 'purpose' then select purpose::text into v from public.loans where id = p_loan;
    when 'purchase_price' then select trim_scale(purchase_price)::text into v from public.loans where id = p_loan;
    when 'loan_amount' then select trim_scale(loan_amount)::text into v from public.loans where id = p_loan;
    when 'cash_out' then select trim_scale(cash_out_amount)::text into v from public.loans where id = p_loan;
    when 'timeline' then select timeline into v from public.loans where id = p_loan;
    when 'income_doc_type' then select income_doc_type::text into v from public.loans where id = p_loan;
    when 'credit_score' then select estimated_credit_score::text into v from public.loan_borrowers where loan_id = p_loan and contact_id = p_contact;
    else v := null;
  end case;
  return coalesce(v, '');
end;
$$;

-- Writes one mapped field to the file.
create or replace function public.page_field_apply(p_contact uuid, p_loan uuid, p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  case p_key
    when 'first_name' then update public.contacts set first_name = left(p_value, 100) where id = p_contact;
    when 'last_name' then update public.contacts set last_name = left(p_value, 100) where id = p_contact;
    when 'email' then update public.contacts set email = lower(p_value) where id = p_contact;
    when 'phone' then update public.contacts set phone = p_value where id = p_contact;
    when 'purpose' then update public.loans set purpose = p_value::public.loan_purpose where id = p_loan;
    when 'purchase_price' then update public.loans set purchase_price = p_value::numeric where id = p_loan;
    when 'loan_amount' then update public.loans set loan_amount = p_value::numeric where id = p_loan;
    when 'cash_out' then update public.loans set cash_out_amount = p_value::numeric where id = p_loan;
    when 'timeline' then update public.loans set timeline = left(p_value, 200) where id = p_loan;
    when 'income_doc_type' then update public.loans set income_doc_type = p_value::public.income_doc_type where id = p_loan;
    when 'credit_score' then update public.loan_borrowers set estimated_credit_score = p_value::smallint where loan_id = p_loan and contact_id = p_contact;
    else raise exception 'Unknown field: %', p_key;
  end case;
end;
$$;

revoke all on function public.page_field_current(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.page_field_apply(uuid, uuid, text, text) from public, anon, authenticated;

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
-- 7. Accept or Reject one proposed update (whoever can see the file).
--    Accept writes the field and leaves a note on the person.
-- ---------------------------------------------------------------------------

create or replace function public.decide_page_update(p_submission uuid, p_key text, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.page_submissions;
  v_item jsonb;
  v_index int;
  v_title text;
begin
  select * into v_sub from public.page_submissions where id = p_submission;
  if not found or v_sub.loan_id is null or v_sub.contact_id is null or not public.can_see_loan(v_sub.loan_id) then
    raise exception 'That submission isn''t on a file you can see.';
  end if;
  select value, ordinality - 1 into v_item, v_index
  from jsonb_array_elements(v_sub.proposed) with ordinality
  where value->>'key' = p_key;
  if v_item is null then
    raise exception 'No proposed update for that field.';
  end if;
  if v_item->>'status' <> 'pending' then
    raise exception 'That update was already %.', v_item->>'status';
  end if;

  if p_accept then
    perform public.page_field_apply(v_sub.contact_id, v_sub.loan_id, p_key, v_item->>'value');
    select title into v_title from public.pages where id = v_sub.page_id;
    insert into public.notes (organization_id, contact_id, loan_id, kind, body)
    values (v_sub.organization_id, v_sub.contact_id, v_sub.loan_id, 'note',
      format('%s updated from the page "%s": %s (was %s).', v_item->>'label', coalesce(v_title, 'a page'), v_item->>'value', coalesce(v_item->>'current', 'blank')));
  end if;

  update public.page_submissions
  set proposed = jsonb_set(proposed, array[v_index::text], v_item || jsonb_build_object('status', case when p_accept then 'accepted' else 'rejected' end, 'decidedBy', auth.uid(), 'decidedAt', now()))
  where id = p_submission;

  return jsonb_build_object('key', p_key, 'status', case when p_accept then 'accepted' else 'rejected' end);
end;
$$;

revoke all on function public.decide_page_update(uuid, text, boolean) from public, anon;
grant execute on function public.decide_page_update(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Notifications: the page owner hears about each submission (unless the
--    page's "notify" setting is off).
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission'));

create or replace function public.page_submissions_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.pages;
  v_name text;
begin
  select * into v_page from public.pages where id = new.page_id;
  if v_page.owner_id is null or coalesce(v_page.settings->>'notify', 'true') = 'false' then
    return null;
  end if;
  if new.contact_id is not null then
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
  elsif new.partner_id is not null then
    select name into v_name from public.partners where id = new.partner_id;
  end if;
  perform public.notify_user(new.organization_id, v_page.owner_id, 'page_submission',
    coalesce(nullif(v_name, ''), 'Someone') || ' filled out ' || v_page.title,
    case new.outcome
      when 'new_lead' then 'New lead, assigned to you.'
      when 'new_loan_existing_person' then 'A past client: a new file was started.'
      when 'existing_open_loan' then 'Added to their open file.'
      when 'partner_inquiry' then 'Saved to the Partner center.'
      else 'Added to their file.'
    end || case when jsonb_array_length(new.proposed) > 0 then ' ' || jsonb_array_length(new.proposed) || ' proposed update(s) to review.' else '' end,
    case when new.loan_id is not null then '/loans/' || new.loan_id when new.partner_id is not null then '/partners' else '/pages/' || new.page_id || '/submissions' end,
    new.id);
  return null;
exception when others then
  raise warning 'Notification not made for page submission %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.page_submissions_notify() from public, anon, authenticated;

drop trigger if exists page_submissions_notify on public.page_submissions;
create trigger page_submissions_notify
  after insert on public.page_submissions
  for each row execute function public.page_submissions_notify();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ pages installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('pages', 'page_submissions', 'page_view_days')) as tables,
  (select count(*) from storage.buckets where (id = 'page-assets' and public) or (id = 'page-uploads' and not public)) as buckets,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('get_public_page', 'record_page_submission', 'decide_page_update', 'page_submissions_notify', 'guard_page')) as functions,
  (select count(*) from pg_constraint where conname = 'notifications_kind_check' and pg_get_constraintdef(oid) like '%page_submission%') as notification_kind;
