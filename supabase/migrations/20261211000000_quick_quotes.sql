-- LOSuite: Quick Quote (Connor, 2026-10-30).
--
-- quick_quotes: loan options put in front of a borrower before a full
--   pre-qual. The scenario (borrower, price, down payment, credit range...)
--   and the options (lender, program, rate, points...) are kept as typed, so a
--   quote reopens exactly as it was; the figures are worked out in code. A
--   quote belongs to the loan officer who made it, and to the person and loan
--   once it is saved as a lead. Deleting the person deletes their quotes;
--   deleting the loan or the PDF keeps the quote and forgets them.
-- document_kind gets 'quick_quote', so the quote's PDF saves to Documents and
--   can be emailed like the other borrower PDFs.
-- profiles gets the loan officer's photo (in their own folder of the private
--   brand-files bucket, like the signature) and booking link, for the quote's
--   loan officer block and QR code.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite quick quotes installed").

-- ---------------------------------------------------------------------------
-- 1. The document kind and the profile fields
-- ---------------------------------------------------------------------------

alter type public.document_kind add value if not exists 'quick_quote';

alter table public.profiles add column if not exists photo_path text;
alter table public.profiles add column if not exists booking_url text;

do $$ begin
  alter table public.profiles
    add constraint profiles_photo_in_own_folder check (photo_path is null or photo_path ~ ('^[0-9a-f-]{36}/signatures/' || id::text || '/[^/]+$'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_booking_url_https check (booking_url is null or booking_url ~ '^https://[^\s/]+\.[^\s]+$');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. quick_quotes
-- ---------------------------------------------------------------------------

create table if not exists public.quick_quotes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lo_user_id       uuid default auth.uid(),
  contact_id       uuid,
  loan_id          uuid,
  scenario         jsonb not null default '{}'::jsonb check (jsonb_typeof(scenario) = 'object'),
  options          jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  note             text,
  valid_through    date not null,
  -- The last PDF made from it, on the loan's Documents.
  document_id      uuid,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint quick_quotes_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- A loan officer who leaves keeps their quotes on file, unowned.
  constraint quick_quotes_lo_user_id_fkey
    foreign key (lo_user_id) references public.profiles (id) on delete set null,
  -- Deleting the person deletes their quotes.
  constraint quick_quotes_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  -- Deleting the loan keeps the quote and forgets the loan.
  constraint quick_quotes_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id),
  constraint quick_quotes_document_id_fkey
    foreign key (document_id) references public.loan_documents (id) on delete set null,
  constraint quick_quotes_loan_needs_person check (loan_id is null or contact_id is not null)
);

create index if not exists quick_quotes_lo_idx on public.quick_quotes (lo_user_id, updated_at desc);
create index if not exists quick_quotes_contact_idx on public.quick_quotes (contact_id);
create index if not exists quick_quotes_loan_idx on public.quick_quotes (loan_id);
create index if not exists quick_quotes_document_idx on public.quick_quotes (document_id);

drop trigger if exists quick_quotes_set_updated_at on public.quick_quotes;
create trigger quick_quotes_set_updated_at
  before update on public.quick_quotes
  for each row execute function public.set_updated_at();

-- The maker never changes, a loan is one of the person's own, and the PDF is
-- one of that loan's documents.
create or replace function public.guard_quick_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.lo_user_id is distinct from old.lo_user_id and auth.uid() is not null then
    raise exception 'A quote stays with the loan officer who made it.';
  end if;
  if new.loan_id is not null and not exists (
    select 1 from public.loan_borrowers lb where lb.loan_id = new.loan_id and lb.contact_id = new.contact_id
  ) then
    raise exception 'That loan is not this person''s.';
  end if;
  if new.document_id is not null and not exists (
    select 1 from public.loan_documents d where d.id = new.document_id and d.loan_id is not distinct from new.loan_id
  ) then
    raise exception 'That PDF is not on this quote''s loan.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_quick_quote() from public, anon, authenticated;

drop trigger if exists quick_quotes_guard on public.quick_quotes;
create trigger quick_quotes_guard
  before insert or update on public.quick_quotes
  for each row execute function public.guard_quick_quote();

-- ---------------------------------------------------------------------------
-- 3. Who sees a quote: the loan officer who made it, the admin role (sees
--    every file), and anyone who can see its loan or person.
-- ---------------------------------------------------------------------------

alter table public.quick_quotes enable row level security;

create or replace function public.can_see_quick_quote(org uuid, lo uuid, contact uuid, loan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_org_member(org)
    and (
      lo = auth.uid()
      or public.sees_all_files(org)
      or (loan is not null and public.can_see_loan(loan))
      or (contact is not null and public.can_see_contact(contact))
    );
$$;

revoke all on function public.can_see_quick_quote(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.can_see_quick_quote(uuid, uuid, uuid, uuid) to authenticated;

drop policy if exists "quick quotes: read" on public.quick_quotes;
create policy "quick quotes: read" on public.quick_quotes
  for select to authenticated
  using (public.can_see_quick_quote(organization_id, lo_user_id, contact_id, loan_id));

drop policy if exists "quick quotes: add your own" on public.quick_quotes;
create policy "quick quotes: add your own" on public.quick_quotes
  for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and lo_user_id = auth.uid()
    and (contact_id is null or public.can_see_contact(contact_id))
    and (loan_id is null or public.can_see_loan(loan_id))
  );

drop policy if exists "quick quotes: change" on public.quick_quotes;
create policy "quick quotes: change" on public.quick_quotes
  for update to authenticated
  using (public.can_see_quick_quote(organization_id, lo_user_id, contact_id, loan_id))
  with check (
    public.can_see_quick_quote(organization_id, lo_user_id, contact_id, loan_id)
    and (contact_id is null or public.can_see_contact(contact_id))
    and (loan_id is null or public.can_see_loan(loan_id))
  );

drop policy if exists "quick quotes: delete your own" on public.quick_quotes;
create policy "quick quotes: delete your own" on public.quick_quotes
  for delete to authenticated
  using (public.is_org_member(organization_id) and (lo_user_id = auth.uid() or public.sees_all_files(organization_id)));

grant select, insert, update, delete on public.quick_quotes to authenticated;
revoke all on public.quick_quotes from anon;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite quick quotes installed' as result,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'quick_quotes' and column_name in ('lo_user_id', 'contact_id', 'loan_id', 'scenario', 'options', 'note', 'valid_through', 'document_id', 'sent_at'))
        or (table_name = 'profiles' and column_name in ('photo_path', 'booking_url')))) as columns,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel = 'quick_quote') as document_kind,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'quick_quotes') as policies,
  (select count(*) from public.quick_quotes) as quotes;
