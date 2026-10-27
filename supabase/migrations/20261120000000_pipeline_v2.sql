-- LOSuite: Pipeline v2, step 1 (pipelines by loan type; docs/plans/pipeline-v2.md).
--
-- Adds the "Home Search" stage (purchases: between Pre-Approved and Under
-- Contract), the priority star and the status detail (where a file is inside
-- its stage). Changing stage clears the status detail, whichever way the stage
-- changes (by hand, a milestone, or a web lead). The timeline already lives in
-- loans.timeline. Each pipeline is a view of loans.stage + loans.purpose, so
-- there is nothing else to store.
-- Apply to the DEV Supabase project only, after the assistant chats script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite pipeline v2 installed").

alter type public.pipeline_stage add value if not exists 'home_search' after 'pre_approved';

-- Rank for "a milestone never moves a file backward". Compares the text so it
-- works in the same run that adds the new stage.
create or replace function public.stage_rank(s public.pipeline_stage)
returns integer
language sql immutable
as $$
  select case s::text
    when 'lead' then 1 when 'contacted' then 2 when 'pre_qualified' then 3 when 'pre_approved' then 4
    when 'home_search' then 5 when 'under_contract' then 6 when 'processing' then 7 when 'clear_to_close' then 8 when 'closed' then 9
    else 0
  end
$$;

alter table public.loans add column if not exists priority boolean not null default false;
alter table public.loans add column if not exists status_detail text;

do $$ begin
  alter table public.loans add constraint loans_status_detail_length check (status_detail is null or length(status_detail) between 1 and 80);
exception when duplicate_object then null;
end $$;

create index if not exists loans_priority_idx on public.loans (organization_id) where priority;

-- The status detail describes the stage it was picked in: a new stage starts blank.
create or replace function public.clear_status_detail_on_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage and new.status_detail is not distinct from old.status_detail then
    new.status_detail := null;
  end if;
  return new;
end;
$$;

drop trigger if exists loans_clear_status_detail on public.loans;
create trigger loans_clear_status_detail
  before update of stage on public.loans
  for each row execute function public.clear_status_detail_on_stage_change();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite pipeline v2 installed' as result,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'pipeline_stage' and e.enumlabel = 'home_search') as home_search_stage,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('priority', 'status_detail')) as loan_columns;
