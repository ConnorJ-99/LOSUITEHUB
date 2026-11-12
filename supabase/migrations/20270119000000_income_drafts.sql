-- MPS HQ: AI income drafts (Stage 4, Connor 2026-11-12; plan docs/plans/income-calculation.md).
--
-- "Calculate income" fills income worksheets from the analyzed uploads as
-- DRAFTS beside any worksheet Connor typed (never over one):
--   income_worksheets.status               draft | final (everything before this is final)
--   income_worksheets.source               manual | ai
--   income_worksheets.source_document_ids  the uploads each figure came from
--   income_worksheets.source_notes         what the calculation chose and why
-- Accept = the usual Push to 1003; pushing a draft makes it final (trigger).
-- document_kind gains 'income_analysis' for the one-page Income Analysis PDF.
-- Apply after the document analyses script. Safe to run more than once. A
-- full run ends with a confirmation row ("MPS HQ income drafts installed").

alter type public.document_kind add value if not exists 'income_analysis';

alter table public.income_worksheets
  add column if not exists status              text not null default 'final',
  add column if not exists source              text not null default 'manual',
  add column if not exists source_document_ids uuid[] not null default '{}',
  add column if not exists source_notes        text[] not null default '{}';

alter table public.income_worksheets drop constraint if exists income_worksheets_status_check;
alter table public.income_worksheets add constraint income_worksheets_status_check check (status in ('draft', 'final'));
alter table public.income_worksheets drop constraint if exists income_worksheets_source_check;
alter table public.income_worksheets add constraint income_worksheets_source_check check (source in ('manual', 'ai'));

-- Pushing a draft to the 1003 is accepting it.
create or replace function public.income_worksheet_accept_on_push()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'draft' and new.pushed_at is not null and new.pushed_at is distinct from old.pushed_at then
    new.status := 'final';
  end if;
  return new;
end;
$$;

drop trigger if exists income_worksheets_accept_on_push on public.income_worksheets;
create trigger income_worksheets_accept_on_push before update on public.income_worksheets
  for each row execute function public.income_worksheet_accept_on_push();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ income drafts installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'income_worksheets' and column_name in ('status', 'source', 'source_document_ids', 'source_notes')) as columns,
  (select count(*) from pg_trigger where tgname = 'income_worksheets_accept_on_push') as triggers,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel = 'income_analysis') as pdf_kind;
