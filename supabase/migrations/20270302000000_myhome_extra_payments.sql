-- MPS HQ: extra payments a borrower made, logged in MyHome (Connor,
-- 2026-11-23: "something that says and LOGS that they made an additional
-- payment to update their balance and estimated payments"; one-time payments
-- only, and they show on the closed file too).
--
-- myhome_extra_payments: one row per extra principal payment the borrower
-- reports on a closed loan (the date and the amount). MyHome's balance,
-- equity and schedule, and the closed file's Mortgage today card, count them.
-- Only the myhome Edge Function (service role) adds or removes them, through
-- myhome_record_payment() / myhome_remove_payment(), which check the account
-- is on, its person is a borrower on the file and the file is closed. A
-- removed one stays with removed_at (the borrower fixing a mistake). Staff who
-- can see the file read them. Each add and remove leaves a note on the file.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome extra payments installed").

create table if not exists public.myhome_extra_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  contact_id       uuid not null,
  account_id       uuid not null,
  paid_on          date not null,
  amount           numeric(14, 2) not null check (amount > 0 and amount < 100000000),
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  constraint myhome_extra_payments_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint myhome_extra_payments_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint myhome_extra_payments_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint myhome_extra_payments_account_id_fkey
    foreign key (account_id) references public.borrower_accounts (id) on delete cascade
);

create index if not exists myhome_extra_payments_loan_idx on public.myhome_extra_payments (loan_id, paid_on);

alter table public.myhome_extra_payments enable row level security;
drop policy if exists "people who see the file see its extra payments" on public.myhome_extra_payments;
create policy "people who see the file see its extra payments" on public.myhome_extra_payments
  for select to authenticated using (public.can_see_loan(loan_id));
revoke insert, update, delete on public.myhome_extra_payments from anon, authenticated;

create or replace function public.myhome_record_payment(p_account uuid, p_loan uuid, p_paid_on date, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  v_loan public.loans;
  v_id uuid;
  v_name text;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then
    raise exception 'This MyHome account is not on.';
  end if;
  select * into v_loan from public.loans where id = p_loan and organization_id = a.organization_id;
  if v_loan.id is null or not exists (select 1 from public.loan_borrowers lb where lb.loan_id = p_loan and lb.contact_id = a.contact_id) then
    raise exception 'That loan is not yours.';
  end if;
  if v_loan.stage <> 'closed' then
    raise exception 'This loan has not closed.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount you paid.';
  end if;
  if v_loan.loan_amount is not null and p_amount > v_loan.loan_amount then
    raise exception 'That is more than the loan amount.';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'America/Chicago')::date then
    raise exception 'Enter the date you paid it (today or earlier).';
  end if;
  if p_paid_on < coalesce(v_loan.closing_date, v_loan.funding_date, p_paid_on) then
    raise exception 'That date is before your loan closed.';
  end if;

  insert into public.myhome_extra_payments (organization_id, loan_id, contact_id, account_id, paid_on, amount)
  values (a.organization_id, p_loan, a.contact_id, a.id, p_paid_on, p_amount)
  returning id into v_id;

  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = a.contact_id;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (a.organization_id, a.contact_id, p_loan, 'note',
    coalesce(v_name, 'The borrower') || ' reported an extra payment of $' || to_char(p_amount, 'FM999,999,990.00') || ' made ' || to_char(p_paid_on, 'Mon DD, YYYY') || ' (MyHome).');
  return v_id;
end;
$$;

create or replace function public.myhome_remove_payment(p_account uuid, p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.myhome_extra_payments;
  v_name text;
begin
  select * into p from public.myhome_extra_payments where id = p_payment and account_id = p_account and removed_at is null;
  if p.id is null then
    raise exception 'That payment isn''t in your MyHome.';
  end if;
  update public.myhome_extra_payments set removed_at = now() where id = p_payment;
  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = p.contact_id;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (p.organization_id, p.contact_id, p.loan_id, 'note',
    coalesce(v_name, 'The borrower') || ' removed the extra payment of $' || to_char(p.amount, 'FM999,999,990.00') || ' from ' || to_char(p.paid_on, 'Mon DD, YYYY') || ' (MyHome).');
end;
$$;

revoke all on function public.myhome_record_payment(uuid, uuid, date, numeric) from public, anon, authenticated;
revoke all on function public.myhome_remove_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.myhome_record_payment(uuid, uuid, date, numeric) to service_role;
grant execute on function public.myhome_remove_payment(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ MyHome extra payments installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'myhome_extra_payments') as tables,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('myhome_record_payment', 'myhome_remove_payment')) as functions;
