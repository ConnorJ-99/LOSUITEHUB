-- Only for the DEV project, and only if the Phase 1 script
-- (20261025000000_contacts_pipeline.sql) failed or ran partly.
-- Removes leftover Phase 1 types and functions so the full script can run.
-- Phase 0 tables (organizations, profiles, organization_members) are untouched.
--
-- Safety: refuses to run unless this database is the LOSuite one (has the
-- MPS organization) and has no Phase 1 tables yet. Nothing is dropped with
-- CASCADE, so anything else that depends on these pieces makes it stop instead.

do $$
begin
  if to_regclass('public.organization_members') is null or to_regclass('public.organizations') is null then
    raise exception 'Stopped: this is not the LOSuite dev database. Nothing was changed.';
  end if;
  if not exists (select 1 from public.organizations where nmls = '2501110') then
    raise exception 'Stopped: this is not the LOSuite dev database. Nothing was changed.';
  end if;
  if to_regclass('public.loans') is not null or to_regclass('public.contacts') is not null then
    raise exception 'Stopped: Phase 1 tables already exist here. Nothing was changed.';
  end if;

  drop function if exists public.create_lead;
  drop function if exists public.can_see_contact;
  drop function if exists public.can_see_loan;
  drop function if exists public.is_org_manager;
  drop function if exists public.loans_log_stage;
  drop function if exists public.loans_before_stage_change;
  drop function if exists public.set_updated_at;

  drop type if exists public.borrower_role;
  drop type if exists public.loan_purpose;
  drop type if exists public.pipeline_stage;

  raise notice 'Cleanup finished. Now run the full Phase 1 script.';
end;
$$;
