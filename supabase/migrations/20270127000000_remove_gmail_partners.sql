-- MPS HQ: remove the Gmail partner switch (Connor, 2026-11-14).
--
-- The Gmail connection was dropped (Google's company sharing rule blocked
-- the setup), so title and insurance partners go through GoHighLevel like
-- everyone else again. This removes what 20270125000000 added for Gmail:
-- partners.email_via_gmail, the GoHighLevel block in partner_defaults and
-- the text block on send_approvals. Everything else (insurance and title
-- fields, wire callback phone guard, loan numbers, mortgagee clauses) stays.
--
-- Safe to re-run. Ends with a confirmation row.

-- The defaults trigger keeps only the wire callback guard.
create or replace function public.partner_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The wire callback number is typed by a person, never by a server process reading an email.
  if coalesce(current_setting('request.jwt.claims', true), '') <> ''
     and coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'role', '') = 'service_role'
     and new.wire_verify_phone is distinct from (case when tg_op = 'UPDATE' then old.wire_verify_phone end) then
    new.wire_verify_phone := case when tg_op = 'UPDATE' then old.wire_verify_phone end;
  end if;
  return new;
end;
$$;
revoke all on function public.partner_defaults() from public;
do $$ begin
  revoke all on function public.partner_defaults() from anon, authenticated;
exception when undefined_object then null; end $$;

drop trigger if exists partners_defaults on public.partners;
create trigger partners_defaults
  before insert or update on public.partners
  for each row execute function public.partner_defaults();

do $$ begin
  if to_regclass('public.send_approvals') is not null then
    drop trigger if exists send_approvals_gmail_partner on public.send_approvals;
  end if;
end $$;
drop function if exists public.guard_gmail_partner_send();

alter table public.partners drop column if exists email_via_gmail;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ Gmail partner switch removed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'partners' and column_name = 'email_via_gmail') as gmail_columns_left;
