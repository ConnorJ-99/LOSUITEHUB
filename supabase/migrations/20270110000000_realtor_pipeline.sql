-- MPS HQ: realtors get an opportunity in GHL's realtor pipeline (Connor 2026-11-11).
--
-- Adding a realtor to GoHighLevel only made a contact. Now it also puts them in
-- the GHL pipeline and stage picked in Settings → GHL pipelines ("When a
-- realtor is added to GoHighLevel"), once: a realtor already in that pipeline
-- keeps their opportunity, never a second one.
--   messaging_settings.realtor_pipeline_id / realtor_stage_id / realtor_label
--   partners.ghl_opportunity_id   set only by the ghl function
-- Apply after the review requests script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ realtor pipeline installed").

alter table public.messaging_settings add column if not exists realtor_pipeline_id text;
alter table public.messaging_settings add column if not exists realtor_stage_id text;
alter table public.messaging_settings add column if not exists realtor_label text;

alter table public.partners add column if not exists ghl_opportunity_id text;
create unique index if not exists partners_ghl_opportunity_key on public.partners (organization_id, ghl_opportunity_id) where ghl_opportunity_id is not null;

-- Only the ghl function (signed in as nobody) sets a partner's GHL opportunity.
create or replace function public.guard_partner_ghl_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.ghl_opportunity_id is distinct from (case when tg_op = 'UPDATE' then old.ghl_opportunity_id end) then
    raise exception 'A partner''s GHL opportunity is set by GoHighLevel matching, not by hand.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_partner_ghl_opportunity() from public, anon, authenticated;
drop trigger if exists partners_guard_ghl_opportunity on public.partners;
create trigger partners_guard_ghl_opportunity before insert or update of ghl_opportunity_id on public.partners
  for each row execute function public.guard_partner_ghl_opportunity();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ realtor pipeline installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messaging_settings' and column_name in ('realtor_pipeline_id', 'realtor_stage_id', 'realtor_label')) as setting_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'partners' and column_name = 'ghl_opportunity_id') as partner_column,
  (select count(*) from pg_trigger where tgname = 'partners_guard_ghl_opportunity') as guard;
