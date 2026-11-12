-- MPS HQ: put a file on hold (Connor, 2026-11-12).
--
-- A client waiting for a known reason (a refi waiting on a lease, rates,
-- seasoning, selling another home...) isn't Nurture: the file stays in its
-- stage and is marked on hold with a reason (picked or typed). Its timeline
-- is the card's existing loans.timeline. On-hold files show in "On Hold
-- Leads" on the Leads page, next to Priority Leads.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("MPS HQ loan hold installed").

alter table public.loans
  add column if not exists on_hold_at   timestamptz,
  add column if not exists hold_reason  text;

-- A reason only on a file that's on hold, and never blank.
do $$ begin
  alter table public.loans add constraint loans_hold_shape check (
    (on_hold_at is null and hold_reason is null)
    or (on_hold_at is not null and (hold_reason is null or length(trim(hold_reason)) > 0))
  );
exception when duplicate_object then null; end $$;

create index if not exists loans_on_hold_idx on public.loans (organization_id) where on_hold_at is not null;

select
  'MPS HQ loan hold installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('on_hold_at', 'hold_reason')) as hold_columns;
