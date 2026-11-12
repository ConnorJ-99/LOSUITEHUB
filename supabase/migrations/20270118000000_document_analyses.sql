-- MPS HQ: upload analysis (Stage 3b, Connor 2026-11-12; plan docs/plans/employment-documents.md).
--
-- document_analyses: one row per uploaded document (made by a trigger when a
-- PDF or photo lands in loan_documents; the app's own PDFs and contracts are
-- left out). The assistant Edge Function (task document_read_due, called by
-- the timer below) reads it with Claude and saves a SUGGESTED type with its
-- confidence, the key fields (each with the words it came from) and flags.
-- Nothing on the file changes: Connor accepts the type, adds a new employer,
-- or ignores it. Status: queued → analyzing → ready / needs_review, or back
-- to queued with a later try (after 1, 5, then 30 minutes) until the third
-- failure, then failed. Re-run analysis puts it back in the queue. A stuck
-- "analyzing" (over 10 minutes) is picked up again.
-- Without the Anthropic key the function leaves the row queued, says why,
-- and tries again in an hour.
-- Apply after the hot programs script. Needs pg_cron and pg_net (already on
-- for scheduled sends) and the Vault secrets losuite_project_url,
-- ghl_webhook_secret and losuite_anon_key. Safe to run more than once. A full
-- run ends with a confirmation row ("MPS HQ document analyses installed").

create table if not exists public.document_analyses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  document_id      uuid not null,
  status           text not null default 'queued' check (status in ('queued', 'analyzing', 'ready', 'needs_review', 'failed')),
  attempts         smallint not null default 0 check (attempts between 0 and 20),
  next_try_at      timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  last_error       text,
  -- The AI's suggestion; the document's own kind is only changed by Connor.
  suggested_kind   public.document_kind,
  kind_confidence  text check (kind_confidence in ('high', 'medium', 'low')),
  -- {"employer_name": {"value": "Excel Inc", "quote": "EXCEL INC"}, "pay_date": {...}, ...}
  fields           jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  -- [{"code": "employer_mismatch", "text": "...", "severity": "warn"}] (worked out in code from fields + the 1003)
  flags            jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  model            text,
  ai_run_id        uuid,
  -- Connor's answer to the suggested type, and the job added from it.
  kind_decision    text check (kind_decision in ('accepted', 'dismissed')),
  employer_job_id  uuid,
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint document_analyses_document_key unique (document_id),
  constraint document_analyses_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint document_analyses_document_id_fkey
    foreign key (document_id) references public.loan_documents (id) on delete cascade,
  constraint document_analyses_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint document_analyses_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null
);

create index if not exists document_analyses_due_idx on public.document_analyses (next_try_at) where status = 'queued';
create index if not exists document_analyses_loan_idx on public.document_analyses (loan_id);

create or replace trigger document_analyses_set_updated_at
  before update on public.document_analyses
  for each row execute function public.set_updated_at();

alter table public.document_analyses enable row level security;
drop policy if exists "people on the file see analyses" on public.document_analyses;
create policy "people on the file see analyses" on public.document_analyses
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "people on the file decide analyses" on public.document_analyses;
create policy "people on the file decide analyses" on public.document_analyses
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
revoke insert, delete on public.document_analyses from anon, authenticated;

-- In the app: only Re-run (back to queued, attempts reset) and Connor's decisions.
create or replace function public.guard_document_analysis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status = 'queued' and old.status <> 'queued' and old.status <> 'analyzing' then
    -- Re-run analysis.
    new.attempts := 0;
    new.next_try_at := now();
    new.last_error := null;
    new.started_at := null;
    new.finished_at := null;
  elsif new.status is distinct from old.status then
    raise exception 'Only Re-run analysis can change an analysis''s status.';
  end if;
  if (new.loan_id, new.document_id, new.suggested_kind, new.kind_confidence, new.fields, new.flags, new.model, new.ai_run_id)
     is distinct from (old.loan_id, old.document_id, old.suggested_kind, old.kind_confidence, old.fields, old.flags, old.model, old.ai_run_id) then
    raise exception 'The analysis itself can''t be edited; accept or dismiss it instead.';
  end if;
  if (new.kind_decision, new.employer_job_id) is distinct from (old.kind_decision, old.employer_job_id) then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists document_analyses_guard on public.document_analyses;
create trigger document_analyses_guard before update on public.document_analyses
  for each row execute function public.guard_document_analysis();

-- Every uploaded PDF or photo gets an analysis (not the app's own PDFs or contracts, which have their own reader).
create or replace function public.queue_document_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.content_type, '') in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')
     and new.kind::text not in ('preapproval_letter', 'fee_worksheet', 'loan_comparison', 'quick_quote', 'prequal_results', 'purchase_contract', 'contract_addendum', 'appraisal', 'title_commitment') then
    insert into public.document_analyses (organization_id, loan_id, document_id)
    values (new.organization_id, new.loan_id, new.id)
    on conflict (document_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_document_analysis() from public, anon, authenticated;
drop trigger if exists loan_documents_queue_analysis on public.loan_documents;
create trigger loan_documents_queue_analysis after insert on public.loan_documents
  for each row execute function public.queue_document_analysis();

-- The Edge Function's two steps (service role only).
-- claim: up to p_limit due analyses (and stuck ones) move to analyzing; one caller gets each.
create or replace function public.claim_document_analyses(p_limit integer default 3)
returns setof public.document_analyses
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.document_analyses set status = 'queued', next_try_at = now()
  where status = 'analyzing' and started_at < now() - interval '10 minutes';
  return query
  update public.document_analyses a
  set status = 'analyzing', attempts = a.attempts + 1, started_at = now(), last_error = null
  where a.id in (
    select id from public.document_analyses
    where status = 'queued' and next_try_at <= now()
    order by next_try_at
    limit greatest(1, least(p_limit, 10))
    for update skip locked
  )
  returning a.*;
end;
$$;

-- finish: the result (p_status ready / needs_review), or an error (p_status null) with retry and backoff.
-- p_wait_key = no AI key: back to queued in an hour, the try not counted.
create or replace function public.finish_document_analysis(
  p_id uuid, p_status text, p_kind text, p_confidence text, p_fields jsonb, p_flags jsonb, p_model text, p_run uuid, p_error text, p_wait_key boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.document_analyses;
begin
  select * into a from public.document_analyses where id = p_id;
  if a.id is null then
    return;
  end if;
  if p_wait_key then
    update public.document_analyses set status = 'queued', attempts = greatest(a.attempts - 1, 0), next_try_at = now() + interval '1 hour', last_error = p_error where id = p_id;
  elsif p_status in ('ready', 'needs_review') then
    update public.document_analyses
    set status = p_status, finished_at = now(), last_error = null,
        suggested_kind = p_kind::public.document_kind, kind_confidence = p_confidence,
        fields = coalesce(p_fields, '{}'::jsonb), flags = coalesce(p_flags, '[]'::jsonb), model = p_model, ai_run_id = p_run
    where id = p_id;
  elsif a.attempts >= 3 then
    update public.document_analyses set status = 'failed', finished_at = now(), last_error = left(coalesce(p_error, 'Unknown error'), 500) where id = p_id;
  else
    update public.document_analyses
    set status = 'queued', last_error = left(coalesce(p_error, 'Unknown error'), 500),
        next_try_at = now() + case a.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '30 minutes' end
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.claim_document_analyses(integer) from public, anon, authenticated;
revoke all on function public.finish_document_analysis(uuid, text, text, text, jsonb, jsonb, text, uuid, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The timer: every minute, when something is due, ask the assistant function to read it.
-- ---------------------------------------------------------------------------

create or replace function public.scheduled_document_analysis()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_anon text;
  v_request bigint;
begin
  if not exists (select 1 from public.document_analyses where (status = 'queued' and next_try_at <= now()) or (status = 'analyzing' and started_at < now() - interval '10 minutes')) then
    return 'Nothing due.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'losuite_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ghl_webhook_secret' limit 1;
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'losuite_anon_key' limit 1;
  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_key), '') = '' or coalesce(trim(v_anon), '') = '' then
    return 'Skipped: add losuite_project_url, ghl_webhook_secret and losuite_anon_key in Supabase Vault first.';
  end if;
  select net.http_post(
    url := rtrim(trim(v_url), '/') || '/functions/v1/assistant?key=' || trim(v_key),
    body := jsonb_build_object('task', 'document_read_due'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || trim(v_anon)),
    timeout_milliseconds := 120000
  ) into v_request;
  return 'Asked the assistant to read what''s due (request ' || v_request || ').';
end;
$$;

revoke all on function public.scheduled_document_analysis() from public, anon, authenticated;

select cron.schedule('mpshq-document-analysis', '* * * * *', 'select public.scheduled_document_analysis()');

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ document analyses installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'document_analyses') as analysis_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'document_analyses') as policies,
  (select count(*) from pg_trigger where tgname in ('document_analyses_guard', 'loan_documents_queue_analysis')) as triggers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('claim_document_analyses', 'finish_document_analysis', 'scheduled_document_analysis')) as functions,
  (select count(*) from cron.job where jobname = 'mpshq-document-analysis') as scheduled_jobs,
  (select count(*) from vault.decrypted_secrets where name in ('losuite_project_url', 'ghl_webhook_secret', 'losuite_anon_key')) as vault_secrets_found;
