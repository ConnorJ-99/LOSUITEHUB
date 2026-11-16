-- MPS HQ: lead follow-up wording by AI (Connor, 2026-11-16; plan
-- docs/plans/lead-follow-ups.md, step 4).
--
-- The lead follow-up timer now runs run_lead_followups(): it drafts what's
-- due (draft_lead_followups, unchanged) and, when a waiting TEXT hasn't been
-- worded yet, asks the assistant function (task lead_followup_word_due, the
-- webhook key, like the upload-analysis timer) to reword it once in Connor's
-- voice from the recent conversation. Document requests and emails keep
-- their template. Without the Anthropic key the templates stay. The draft
-- records payload.worded = 'ai' or 'template'.
--
-- Needs the same Supabase Vault entries as the upload-analysis timer
-- (losuite_project_url, ghl_webhook_secret, losuite_anon_key); without them
-- drafts are still made, just not reworded.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ lead follow-up wording installed").

create or replace function public.run_lead_followups()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drafted integer;
  v_url text;
  v_key text;
  v_anon text;
  v_request bigint;
begin
  v_drafted := public.draft_lead_followups();
  if not exists (
    select 1 from public.action_items a
    where a.source = 'lead_followup' and a.status = 'pending' and a.kind = 'draft_message'
      and a.payload->>'worded' is null and a.payload->>'channel' = 'text'
      and coalesce(a.payload->'lead'->>'nextAction', '') <> 'waiting_documents'
      and a.created_at > now() - interval '2 days'
  ) then
    return 'Drafted ' || v_drafted || '; nothing to reword.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'losuite_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ghl_webhook_secret' limit 1;
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'losuite_anon_key' limit 1;
  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_key), '') = '' or coalesce(trim(v_anon), '') = '' then
    return 'Drafted ' || v_drafted || '; not reworded: add losuite_project_url, ghl_webhook_secret and losuite_anon_key in Supabase Vault first.';
  end if;
  select net.http_post(
    url := rtrim(trim(v_url), '/') || '/functions/v1/assistant?key=' || trim(v_key),
    body := jsonb_build_object('task', 'lead_followup_word_due'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || trim(v_anon)),
    timeout_milliseconds := 120000
  ) into v_request;
  return 'Drafted ' || v_drafted || '; asked the assistant to reword (request ' || v_request || ').';
end;
$$;

revoke all on function public.run_lead_followups() from public, anon, authenticated;

select cron.unschedule('mpshq-lead-followups') where exists (select 1 from cron.job where jobname = 'mpshq-lead-followups');
select cron.schedule('mpshq-lead-followups', '*/30 * * * *', 'select public.run_lead_followups()');

select
  'MPS HQ lead follow-up wording installed' as result,
  (select count(*) from cron.job where jobname = 'mpshq-lead-followups' and command like '%run_lead_followups%') as timer,
  (select count(*) from vault.decrypted_secrets where name in ('losuite_project_url', 'ghl_webhook_secret', 'losuite_anon_key')) as vault_secrets_found;
