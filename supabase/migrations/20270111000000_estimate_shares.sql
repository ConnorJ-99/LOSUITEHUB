-- MPS HQ: share estimates with borrowers by link (build plan Phase 7; plan
-- docs/plans/estimate-share-links.md, approved 2026-11-11).
--
--   estimate_shares        one link: the file, the person it went to, the
--                          chosen estimates, a FROZEN copy of their numbers
--                          (snapshot; later edits on the file never change what
--                          the borrower sees), a 64-character random token, who
--                          made it, expiry, revoked, first / last opened, views,
--                          the option the borrower picked, and the current
--                          24-hour viewing session (stored hashed)
--   estimate_share_events  every email check, open and pick, with the time and
--                          whether it worked (the guessing limit and the record)
-- No sign-in code (Connor): the page opens when the typed email matches a
-- borrower on the file; 5 wrong emails in an hour lock the link for the hour.
-- Only the estimate-view Edge Function (service role) reads shares for the
-- public page; in the app, shares follow the file rule.
-- A pick adds a note on the file and notifies the file's loan officer
-- (notification kind estimate_picked); it never messages the borrower back
-- and never selects the estimate on the file.
-- messaging_settings.estimate_share_days: the default link life (7 days).
-- Apply after the realtor pipeline script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ estimate shares installed").

create table if not exists public.estimate_shares (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  loan_id            uuid not null,
  contact_id         uuid not null,
  estimate_ids       uuid[] not null check (cardinality(estimate_ids) between 1 and 5),
  snapshot           jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  channel            text not null check (channel in ('text', 'email')),
  -- 64 random letters and numbers (two random ids): the only thing in the link.
  token              text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') check (length(token) >= 32),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '7 days',
  revoked_at         timestamptz,
  first_opened_at    timestamptz,
  last_opened_at     timestamptz,
  views              integer not null default 0,
  picked_estimate_id uuid,
  picked_at          timestamptz,
  session_hash       text,
  session_expires_at timestamptz,
  constraint estimate_shares_token_key unique (token),
  constraint estimate_shares_expiry check (expires_at > created_at and expires_at <= created_at + interval '60 days'),
  constraint estimate_shares_picked_is_shared check (picked_estimate_id is null or picked_estimate_id = any(estimate_ids)),
  constraint estimate_shares_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint estimate_shares_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint estimate_shares_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint estimate_shares_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index if not exists estimate_shares_loan_idx on public.estimate_shares (loan_id, created_at desc);

alter table public.estimate_shares enable row level security;
drop policy if exists "people on the file see its shares" on public.estimate_shares;
create policy "people on the file see its shares" on public.estimate_shares
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "the file's LO or an admin shares" on public.estimate_shares;
create policy "the file's LO or an admin shares" on public.estimate_shares
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.may_approve_send(loan_id, auth.uid()));
drop policy if exists "people on the file revoke shares" on public.estimate_shares;
create policy "people on the file revoke shares" on public.estimate_shares
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
-- No delete: a share is the record of what was sent.

-- In the app only revoking changes a share; opens, picks and sessions come from the Edge Function.
create or replace function public.guard_estimate_share()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
    (new.snapshot, new.estimate_ids, new.token, new.contact_id, new.loan_id, new.channel, new.expires_at, new.views, new.first_opened_at, new.last_opened_at, new.picked_estimate_id, new.picked_at, new.session_hash, new.session_expires_at)
    is distinct from
    (old.snapshot, old.estimate_ids, old.token, old.contact_id, old.loan_id, old.channel, old.expires_at, old.views, old.first_opened_at, old.last_opened_at, old.picked_estimate_id, old.picked_at, old.session_hash, old.session_expires_at)
  ) then
    raise exception 'A shared link can only be revoked. To change it, share again (a new link).';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at and auth.uid() is not null then
    raise exception 'This link is already revoked.';
  end if;
  return new;
end;
$$;

drop trigger if exists estimate_shares_guard on public.estimate_shares;
create trigger estimate_shares_guard before update on public.estimate_shares
  for each row execute function public.guard_estimate_share();

create table if not exists public.estimate_share_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  share_id         uuid not null,
  kind             text not null check (kind in ('email_ok', 'email_wrong', 'locked', 'opened', 'pdf', 'picked', 'expired')),
  created_at       timestamptz not null default now(),
  constraint estimate_share_events_share_id_fkey
    foreign key (share_id) references public.estimate_shares (id) on delete cascade,
  constraint estimate_share_events_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade
);

create index if not exists estimate_share_events_share_idx on public.estimate_share_events (share_id, created_at desc);
alter table public.estimate_share_events enable row level security;
drop policy if exists "people on the file see share events" on public.estimate_share_events;
create policy "people on the file see share events" on public.estimate_share_events
  for select to authenticated using (exists (select 1 from public.estimate_shares s where s.id = share_id and public.can_see_loan(s.loan_id)));
revoke insert, update, delete on public.estimate_share_events from anon, authenticated;

-- The default link life, in Settings → Sending.
alter table public.messaging_settings add column if not exists estimate_share_days smallint not null default 7;
alter table public.messaging_settings drop constraint if exists messaging_settings_estimate_share_days_check;
alter table public.messaging_settings add constraint messaging_settings_estimate_share_days_check check (estimate_share_days between 1 and 60);

-- A pick: a note on the file and a notification for its loan officer.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission', 'estimate_picked'));

create or replace function public.estimate_share_picked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_option text;
  v_lo uuid;
begin
  if new.picked_estimate_id is null or new.picked_estimate_id is not distinct from old.picked_estimate_id then
    return new;
  end if;
  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = new.contact_id;
  select coalesce(o->>'name', 'an option') into v_option
  from jsonb_array_elements(new.snapshot->'options') o where o->>'estimateId' = new.picked_estimate_id::text limit 1;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (new.organization_id, new.contact_id, new.loan_id, 'note', coalesce(v_name, 'The borrower') || ' said they''re interested in ' || coalesce(v_option, 'an option') || ' (shared estimates link).');
  select assigned_lo_id into v_lo from public.loans where id = new.loan_id;
  perform public.notify_user(new.organization_id, v_lo, 'estimate_picked', coalesce(v_name, 'A borrower') || ' picked an option', coalesce(v_option, ''), '/loans/' || new.loan_id::text || '?tab=estimates', new.id);
  return new;
end;
$$;

revoke all on function public.estimate_share_picked() from public, anon, authenticated;
drop trigger if exists estimate_shares_picked on public.estimate_shares;
create trigger estimate_shares_picked after update of picked_estimate_id on public.estimate_shares
  for each row execute function public.estimate_share_picked();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ estimate shares installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('estimate_shares', 'estimate_share_events')) as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('estimate_shares', 'estimate_share_events')) as policies,
  (select count(*) from pg_trigger where tgname in ('estimate_shares_guard', 'estimate_shares_picked')) as triggers,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messaging_settings' and column_name = 'estimate_share_days') as share_days;
