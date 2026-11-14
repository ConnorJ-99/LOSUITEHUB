-- MPS HQ: Pipeline redesign (Connor, 2026-11-13).
--
-- 1. Investment is no longer a pipeline. It's the occupancy on a file, and
--    DSCR / bank statement are the income documentation. Files whose purpose
--    is Investment / DSCR move (Connor approved the list on 2026-11-13):
--      a purchase price on file            -> Purchase
--      a cash-out amount on file           -> Cash-out refinance
--      neither (purpose unclear)           -> Purchase, flagged "Needs review: moved from Investment pipeline"
--    each with occupancy Investment, the same stage, and "DSCR" income
--    documentation when its program says DSCR. Every move leaves a note.
--    From now on a new or changed file can't be Investment / DSCR: the
--    database turns it into Purchase or Refinance the same way (website
--    forms, imports, the app).
-- 2. loans.lead_type: the card's loan type (CONV, FHA, VA, USDA, JUMBO, DSCR,
--    BANK STMT, NON-QM OTHER, HELOC). Blank = worked out from the program,
--    mortgage type and income documentation; set it to change the card.
-- 3. loans.current_step: the step inside the stage (1 = first). A stage
--    change resets it to 1; days in stage use the existing stage_changed_at.
--    The new stage Underwriting sits between Processing and Clear to Close.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ pipeline redesign installed").

-- A new stage value can't be used in the same transaction it's added in, so nothing below uses it.
alter type public.pipeline_stage add value if not exists 'underwriting' after 'processing';

alter table public.loans
  add column if not exists lead_type    text,
  add column if not exists current_step smallint not null default 1;

alter table public.loans drop constraint if exists loans_lead_type_check;
alter table public.loans add constraint loans_lead_type_check
  check (lead_type is null or lead_type in ('conv', 'fha', 'va', 'usda', 'jumbo', 'dscr', 'bank_stmt', 'nonqm_other', 'heloc'));
alter table public.loans drop constraint if exists loans_current_step_check;
alter table public.loans add constraint loans_current_step_check check (current_step between 1 and 20);

-- A stage change starts the new stage at step 1.
create or replace function public.reset_step_on_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage then
    new.current_step := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists loans_reset_step on public.loans;
create trigger loans_reset_step before update of stage on public.loans
  for each row execute function public.reset_step_on_stage_change();

-- ---------------------------------------------------------------------------
-- 1. No more Investment / DSCR purpose.
-- ---------------------------------------------------------------------------

create or replace function public.no_investment_purpose()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.purpose::text = 'investment_dscr' then
    new.occupancy := 'investment';
    if coalesce(new.purchase_price, 0) > 0 then
      new.purpose := 'purchase';
    elsif coalesce(new.cash_out_amount, 0) > 0 then
      new.purpose := 'refinance_cash_out';
    else
      new.purpose := 'purchase';
      new.status_detail := coalesce(new.status_detail, 'Needs review: moved from Investment pipeline');
    end if;
    if new.income_doc_type is null and coalesce(new.program_name, '') ilike '%dscr%' then
      new.income_doc_type := 'dscr';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists loans_no_investment_purpose on public.loans;
create trigger loans_no_investment_purpose before insert or update of purpose on public.loans
  for each row execute function public.no_investment_purpose();

-- The files already there: a note on each, then the move (the trigger above does the move).
insert into public.notes (organization_id, contact_id, loan_id, body, author_id)
select l.organization_id, b.contact_id, l.id,
  'Moved from the Investment pipeline: now ' ||
    case when coalesce(l.purchase_price, 0) > 0 then 'a Purchase'
         when coalesce(l.cash_out_amount, 0) > 0 then 'a Cash-out refinance'
         else 'a Purchase (needs review: the purpose wasn''t clear)' end ||
    ' with occupancy Investment' ||
    case when l.income_doc_type is null and coalesce(l.program_name, '') ilike '%dscr%' then ' and DSCR income documentation' else '' end || '.',
  null
from public.loans l
join public.loan_borrowers b on b.loan_id = l.id and b.role = 'primary'
where l.purpose::text = 'investment_dscr';

update public.loans set purpose = 'investment_dscr' where purpose::text = 'investment_dscr';

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ pipeline redesign installed' as result,
  (select count(*) from public.loans where purpose::text = 'investment_dscr') as investment_files_left,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('lead_type', 'current_step')) as columns,
  (select count(*) from pg_trigger where tgname in ('loans_reset_step', 'loans_no_investment_purpose')) as triggers,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'pipeline_stage' and e.enumlabel = 'underwriting') as underwriting_stage;
