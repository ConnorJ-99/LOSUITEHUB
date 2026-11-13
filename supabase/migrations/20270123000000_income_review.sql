-- MPS HQ: income review, part 4d-1 (Connor, 2026-11-13; plan docs/plans/income-review.md).
--
-- Every figure an AI income draft fills in keeps its source, and every change
-- to one of those figures is logged:
--   income_worksheets.input_sources  { "<input>": { documentId, field, value,
--                                      quote, page, derived } } ({} on worksheets typed by hand)
--   income_worksheet_edits           add-only: which figure, the AI's value
--                                      and quote, the new value, who and when
--                                      (approved by Connor 2026-11-13)
-- Apply after the income drafts script. Safe to run more than once. A full
-- run ends with a confirmation row ("MPS HQ income review installed").

alter table public.income_worksheets
  add column if not exists input_sources jsonb not null default '{}'::jsonb;
alter table public.income_worksheets drop constraint if exists income_worksheets_input_sources_check;
alter table public.income_worksheets add constraint income_worksheets_input_sources_check check (jsonb_typeof(input_sources) = 'object');

create table if not exists public.income_worksheet_edits (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  worksheet_id     uuid not null,
  -- The input's path inside the worksheet's inputs ("amount", "recent.netProfit").
  input            text not null check (length(trim(input)) > 0),
  ai_value         numeric,
  ai_quote         text,
  new_value        numeric,
  changed_by       uuid default auth.uid(),
  changed_at       timestamptz not null default now(),
  constraint income_worksheet_edits_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint income_worksheet_edits_worksheet_id_fkey
    foreign key (worksheet_id) references public.income_worksheets (id) on delete cascade,
  constraint income_worksheet_edits_changed_by_fkey
    foreign key (changed_by) references public.profiles (id) on delete set null
);

create index if not exists income_worksheet_edits_worksheet_idx on public.income_worksheet_edits (worksheet_id, changed_at);

alter table public.income_worksheet_edits enable row level security;

-- Seen by whoever can see the worksheet's file.
drop policy if exists "people on the file see income edits" on public.income_worksheet_edits;
create policy "people on the file see income edits" on public.income_worksheet_edits
  for select to authenticated
  using (exists (select 1 from public.income_worksheets w where w.id = worksheet_id and public.can_see_loan(w.loan_id)));

-- Added by someone on the file, as themselves, in the worksheet's company.
drop policy if exists "people on the file log income edits" on public.income_worksheet_edits;
create policy "people on the file log income edits" on public.income_worksheet_edits
  for insert to authenticated
  with check (
    changed_by = auth.uid()
    and exists (select 1 from public.income_worksheets w where w.id = worksheet_id and w.organization_id = income_worksheet_edits.organization_id and public.can_see_loan(w.loan_id))
  );

-- Add-only: never changed or removed in the app.
revoke update, delete on public.income_worksheet_edits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ income review installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'income_worksheets' and column_name = 'input_sources') as input_sources,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'income_worksheet_edits') as edits_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'income_worksheet_edits') as policies;
