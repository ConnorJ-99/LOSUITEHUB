-- LOSuite: pre-approval letters, Product Search v2 step 8c.
--
-- The approved maximum lives on the loan (one place): max purchase price,
-- max loan amount and when the pre-approval expires. Every letter is checked
-- against it.
--
-- preapproval_letters keeps each letter exactly as it was issued: one
-- reference number per pre-approval, versions v1, v2... under it (v1 is
-- usually "up to", later versions name a home and an offer price). A letter
-- keeps its own figures on purpose: it is a record of what was sent, so
-- changing the loan later doesn't rewrite it. Its PDF is in loan_documents.
--
-- The Workflow step "Pre-approval letter" is completed by the file's data
-- (rule "preapproval_letter": a letter was saved) and opens the Letters tab.
--
-- Apply to the DEV Supabase project only, after the generated documents
-- script. Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite pre-approval letters installed").

-- ---------------------------------------------------------------------------
-- The approved maximum, on the loan
-- ---------------------------------------------------------------------------

alter table public.loans add column if not exists preapproval_max_price numeric(14, 2) check (preapproval_max_price >= 0);
alter table public.loans add column if not exists preapproval_max_loan_amount numeric(14, 2) check (preapproval_max_loan_amount >= 0);
alter table public.loans add column if not exists preapproval_expires_on date;

-- ---------------------------------------------------------------------------
-- preapproval_letters
-- ---------------------------------------------------------------------------

create table if not exists public.preapproval_letters (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  loan_id              uuid not null,
  -- The home named in the letter; empty = an "up to" letter. Deleting the
  -- property keeps the letter (its address stays in property_address).
  property_id          uuid,
  reference_number     text not null check (reference_number ~ '^[A-Z0-9-]{4,40}$'),
  version              smallint not null check (version between 1 and 99),
  -- What the letter says, as issued.
  property_address     text,
  purchase_price       numeric(14, 2) not null check (purchase_price > 0),
  loan_amount          numeric(14, 2) not null check (loan_amount > 0 and loan_amount <= purchase_price),
  mortgage_type        public.mortgage_type not null,
  term_months          smallint not null check (term_months between 1 and 480),
  amortization_type    public.amortization_type not null default 'fixed',
  occupancy            public.occupancy not null,
  seller_credits       numeric(14, 2) check (seller_credits >= 0),
  earnest_money        numeric(14, 2) check (earnest_money >= 0),
  show_seller_credits  boolean not null default false,
  show_earnest_money   boolean not null default false,
  show_down_payment    boolean not null default false,
  -- "What we have reviewed" and conditions beyond the standard four.
  reviewed             text[] not null default '{}',
  extra_conditions     text[] not null default '{}',
  issued_on            date not null default current_date,
  expires_on           date not null,
  -- The saved PDF; deleting it from Documents keeps the letter record.
  document_id          uuid,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  constraint preapproval_letters_expires_after_issued check (expires_on >= issued_on),
  -- Deleting a loan deletes its letters.
  constraint preapproval_letters_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  -- The property must be one of this loan's own.
  constraint preapproval_letters_property_id_fkey
    foreign key (property_id, loan_id) references public.properties (id, loan_id) on delete set null (property_id),
  constraint preapproval_letters_document_id_fkey
    foreign key (document_id) references public.loan_documents (id) on delete set null,
  constraint preapproval_letters_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint preapproval_letters_version_key unique (loan_id, reference_number, version)
);

create index if not exists preapproval_letters_loan_id_idx on public.preapproval_letters (loan_id, created_at);
create index if not exists preapproval_letters_property_id_idx on public.preapproval_letters (property_id);
create index if not exists preapproval_letters_document_id_idx on public.preapproval_letters (document_id);

alter table public.preapproval_letters enable row level security;

-- Letters are a record of what was sent: they can be added and linked to
-- their PDF, but not rewritten. Removing one is allowed (e.g. made by mistake).
drop policy if exists "members see letters on permitted loans" on public.preapproval_letters;
create policy "members see letters on permitted loans" on public.preapproval_letters
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add letters on permitted loans" on public.preapproval_letters;
create policy "members add letters on permitted loans" on public.preapproval_letters
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members link letter PDFs on permitted loans" on public.preapproval_letters;
create policy "members link letter PDFs on permitted loans" on public.preapproval_letters
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members remove letters on permitted loans" on public.preapproval_letters;
create policy "members remove letters on permitted loans" on public.preapproval_letters
  for delete to authenticated using (public.can_see_loan(loan_id));

-- Only the PDF link can change after a letter is issued.
create or replace function public.preapproval_letters_only_link_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'document_id') <> (to_jsonb(old) - 'document_id') then
    raise exception 'A pre-approval letter can''t be changed after it''s issued. Make a new version instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists preapproval_letters_only_link_document on public.preapproval_letters;
create trigger preapproval_letters_only_link_document
  before update on public.preapproval_letters
  for each row execute function public.preapproval_letters_only_link_document();

-- ---------------------------------------------------------------------------
-- Workflow: "Pre-approval letter" completes when a letter is saved
-- ---------------------------------------------------------------------------

update public.step_templates
   set rule_key = 'preapproval_letter', action_label = 'Open letters', action_target = 'letters'
 where key = 'preapproval' and rule_key is null;

-- Companies created later get the same (their defaults are seeded with no rule).
create or replace function public.preapproval_step_uses_letters()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rule_key is null then
    new.rule_key := 'preapproval_letter';
    new.action_label := 'Open letters';
    new.action_target := 'letters';
  end if;
  return new;
end;
$$;

drop trigger if exists step_templates_preapproval_uses_letters on public.step_templates;
create trigger step_templates_preapproval_uses_letters
  before insert on public.step_templates
  for each row when (new.key = 'preapproval')
  execute function public.preapproval_step_uses_letters();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite pre-approval letters installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name like 'preapproval_%') as loan_columns,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'preapproval_letters') as letters_table,
  (select count(*) from public.step_templates where key = 'preapproval' and rule_key = 'preapproval_letter') as steps_using_letters,
  (select count(*) from public.step_templates where key = 'preapproval') as preapproval_steps;
