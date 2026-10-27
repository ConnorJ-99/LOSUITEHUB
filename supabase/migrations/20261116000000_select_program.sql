-- LOSuite: Product Search v2, step 8 (choosing a lender and program).
--
-- Adds the Workflow step "Select lender & program" for every company. It is
-- completed by the file's data (rule "program_chosen": a quote was chosen on
-- Loan · Pricing), and "Submit to lender" is blocked until it is.
-- Companies created later get it from seed_step_templates() too.
-- Apply to the DEV Supabase project only, after the matrix import script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite select program installed").

insert into public.step_templates (organization_id, key, name, step_group, owner, purposes, sort_order, requires, rule_key, milestone, action_label, action_target)
select o.id, 'select_program', 'Select lender & program', 'origination', 'loan_officer', null, 55, '{}', 'program_chosen', null, 'Open pricing', 'loan'
from public.organizations o
on conflict (organization_id, key) do nothing;

-- New companies get the step as well (runs after the original defaults).
create or replace function public.seed_select_program_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.step_templates (organization_id, key, name, step_group, owner, purposes, sort_order, requires, rule_key, milestone, action_label, action_target)
  values (new.organization_id, 'select_program', 'Select lender & program', 'origination', 'loan_officer', null, 55, '{}', 'program_chosen', null, 'Open pricing', 'loan')
  on conflict (organization_id, key) do nothing;
  return new;
end;
$$;

-- Fires when a company's first step template is added (i.e. when its defaults are seeded).
drop trigger if exists step_templates_add_select_program on public.step_templates;
create trigger step_templates_add_select_program
  after insert on public.step_templates
  for each row when (new.key = 'prequal')
  execute function public.seed_select_program_step();

select
  'LOSuite select program installed' as result,
  (select count(*) from public.step_templates where key = 'select_program') as companies_with_step,
  (select count(*) from public.organizations) as companies;
