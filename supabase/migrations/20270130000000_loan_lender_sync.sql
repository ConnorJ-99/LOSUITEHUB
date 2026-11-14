-- MPS HQ: one lender per file (Connor, 2026-11-14).
--
-- The lender picked at the top of a file (loans.lender_id, with the lender
-- loan #) and the "Lender" on the Overview (loans.lender_name) were saved
-- separately and could disagree. Now they're kept the same:
--   picking a lender (lender_id)          -> lender_name becomes its name
--   typing a lender name on the Overview  -> lender_id becomes the matching
--                                            lender (by name), or blank
--   clearing the picked lender            -> the name is cleared too (a
--                                            deleted lender keeps the name)
-- Files that disagree now take the picked lender's name.
--
-- Safe to re-run. Ends with a confirmation row.

create or replace function public.sync_loan_lender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id_changed   boolean := case when tg_op = 'INSERT' then new.lender_id is not null else new.lender_id is distinct from old.lender_id end;
  v_name_changed boolean := case when tg_op = 'INSERT' then new.lender_name is not null else new.lender_name is distinct from old.lender_name end;
  v_name         text;
begin
  if v_id_changed then
    if new.lender_id is not null then
      select name into v_name from public.lenders where id = new.lender_id and organization_id = new.organization_id;
      if v_name is not null then new.lender_name := v_name; end if;
    elsif not v_name_changed and exists (select 1 from public.lenders where id = old.lender_id) then
      -- Cleared by a person (not because the lender was deleted).
      new.lender_name := null;
    end if;
  elsif v_name_changed then
    select id into new.lender_id from public.lenders
     where organization_id = new.organization_id and lower(trim(name)) = lower(trim(coalesce(new.lender_name, '')))
     order by created_at limit 1;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_loan_lender() from public;
do $$ begin
  revoke all on function public.sync_loan_lender() from anon, authenticated;
exception when undefined_object then null; end $$;

drop trigger if exists loans_sync_lender on public.loans;
create trigger loans_sync_lender
  before insert or update of lender_id, lender_name on public.loans
  for each row execute function public.sync_loan_lender();

-- Files that disagree now: the picked lender wins (that's what the top of the file shows).
update public.loans l
   set lender_name = x.name
  from public.lenders x
 where x.id = l.lender_id and l.lender_name is distinct from x.name;

-- Typed names that match a lender get linked to it.
update public.loans l
   set lender_id = x.id
  from public.lenders x
 where l.lender_id is null and l.lender_name is not null
   and x.organization_id = l.organization_id and lower(trim(x.name)) = lower(trim(l.lender_name));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ one lender per file installed' as result,
  (select count(*) from public.loans l join public.lenders x on x.id = l.lender_id where l.lender_name is distinct from x.name) as files_that_disagree;
