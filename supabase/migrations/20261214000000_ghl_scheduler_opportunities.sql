-- LOSuite: the scheduler and GHL opportunities (Connor, 2026-11-02; next
-- build Session 2 in docs/plans/next-build.md, decisions 1–3).
--
-- 1. contacts.ghl_opportunity_id: the person's ONE GHL opportunity. Set only
--    by the "ghl" Edge Function (a trigger blocks the app from setting it by
--    hand, like ghl_contact_id).
-- 2. messaging_settings: the pipeline and stage a closed client's opportunity
--    moves to ("Closed" / "Recently Closed"), and the pipeline and stage it
--    moves back to when a closed client starts a new loan. Picked in
--    Settings → GoHighLevel from GHL's own list; the names are kept for the
--    screen.
-- 3. The scheduler: Supabase's pg_cron runs every 10 minutes and, with
--    pg_net, calls ghl-inbound's catch-up with the webhook key. The project
--    address and the key are read from Supabase Vault (secrets named
--    losuite_project_url and ghl_webhook_secret), never written here. Until
--    both are in Vault the job does nothing and says why in its run log.
--
-- Apply to the DEV Supabase project only, after the loan conditions script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite GHL scheduler and opportunities installed").

-- ---------------------------------------------------------------------------
-- 1. The person's GHL opportunity
-- ---------------------------------------------------------------------------

alter table public.contacts add column if not exists ghl_opportunity_id text;

create unique index if not exists contacts_ghl_opportunity_id_key
  on public.contacts (organization_id, ghl_opportunity_id)
  where ghl_opportunity_id is not null;

-- Signed-in users (the app) can't set or change it; Edge Functions using the
-- service role and the SQL Editor (no signed-in user) aren't limited.
create or replace function public.guard_ghl_opportunity_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and new.ghl_opportunity_id is distinct from (case when tg_op = 'UPDATE' then old.ghl_opportunity_id end) then
    raise exception 'A person''s GHL opportunity is set by LOSuite''s GHL connection, not by hand.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_ghl_opportunity_id() from public;

drop trigger if exists guard_ghl_opportunity_id on public.contacts;
create trigger guard_ghl_opportunity_id
  before insert or update of ghl_opportunity_id on public.contacts
  for each row execute function public.guard_ghl_opportunity_id();

-- ---------------------------------------------------------------------------
-- 2. Which GHL pipelines and stages to use
-- ---------------------------------------------------------------------------

alter table public.messaging_settings add column if not exists closed_pipeline_id text;
alter table public.messaging_settings add column if not exists closed_stage_id text;
-- e.g. "Closed · Recently Closed", as GHL named them when picked.
alter table public.messaging_settings add column if not exists closed_label text;
alter table public.messaging_settings add column if not exists comeback_pipeline_id text;
alter table public.messaging_settings add column if not exists comeback_stage_id text;
alter table public.messaging_settings add column if not exists comeback_label text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messaging_settings_closed_pair') then
    alter table public.messaging_settings add constraint messaging_settings_closed_pair
      check ((closed_pipeline_id is null) = (closed_stage_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messaging_settings_comeback_pair') then
    alter table public.messaging_settings add constraint messaging_settings_comeback_pair
      check ((comeback_pipeline_id is null) = (comeback_stage_id is null));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The scheduler
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Calls ghl-inbound's catch-up. Returns what happened, which pg_cron keeps in
-- cron.job_run_details. Runs as its owner so it can read Vault; nobody else
-- can call it.
create or replace function public.scheduled_ghl_catch_up()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'losuite_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ghl_webhook_secret' limit 1;
  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_key), '') = '' then
    return 'Skipped: add losuite_project_url and ghl_webhook_secret in Supabase Vault first.';
  end if;
  if not exists (select 1 from public.messaging_settings where ghl_location_id is not null) then
    return 'Skipped: no company has run Check connection in Settings → GoHighLevel yet.';
  end if;
  select net.http_post(
    url := rtrim(trim(v_url), '/') || '/functions/v1/ghl-inbound?key=' || trim(v_key),
    body := jsonb_build_object('task', 'catch_up'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  ) into v_request;
  return 'Asked ghl-inbound to catch up (request ' || v_request || ').';
end;
$$;

revoke all on function public.scheduled_ghl_catch_up() from public;
revoke all on function public.scheduled_ghl_catch_up() from anon, authenticated;

-- Every 10 minutes. Scheduling the same name again replaces it.
select cron.schedule('losuite-ghl-catch-up', '*/10 * * * *', 'select public.scheduled_ghl_catch_up()');

select
  'LOSuite GHL scheduler and opportunities installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'contacts' and column_name = 'ghl_opportunity_id')
       or (table_name = 'messaging_settings' and column_name in ('closed_pipeline_id', 'closed_stage_id', 'closed_label', 'comeback_pipeline_id', 'comeback_stage_id', 'comeback_label')))) as columns,
  (select count(*) from pg_trigger where tgname = 'guard_ghl_opportunity_id' and tgrelid = 'public.contacts'::regclass) as guards,
  (select count(*) from cron.job where jobname = 'losuite-ghl-catch-up') as scheduled_jobs,
  (select count(*) from vault.decrypted_secrets where name in ('losuite_project_url', 'ghl_webhook_secret')) as vault_secrets_found;
