-- MPS HQ: deleting a file that has a Quick Quote with a PDF (Connor,
-- 2026-11-16: "That PDF is not on this quote's loan." and the file stayed).
--
-- Deleting a file keeps its quick quotes and forgets the loan (on delete set
-- null). The quote's guard then saw its PDF still on the deleted file and
-- stopped the whole delete. Now, when a quote loses its loan, it lets go of
-- that loan's PDF too (the PDF is deleted with the file anyway).
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ quick quote delete fix installed").

create or replace function public.guard_quick_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.lo_user_id is distinct from old.lo_user_id and auth.uid() is not null then
    raise exception 'A quote stays with the loan officer who made it.';
  end if;
  -- The file was deleted (or unlinked): its PDF goes with it.
  if tg_op = 'UPDATE' and old.loan_id is not null and new.loan_id is null then
    new.document_id := null;
  end if;
  if new.loan_id is not null and not exists (
    select 1 from public.loan_borrowers lb where lb.loan_id = new.loan_id and lb.contact_id = new.contact_id
  ) then
    raise exception 'That loan is not this person''s.';
  end if;
  if new.document_id is not null and not exists (
    select 1 from public.loan_documents d where d.id = new.document_id and d.loan_id is not distinct from new.loan_id
  ) then
    raise exception 'That PDF is not on this quote''s loan.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_quick_quote() from public, anon, authenticated;

select
  'MPS HQ quick quote delete fix installed' as result,
  (select count(*) from pg_proc where proname = 'guard_quick_quote' and prosrc like '%its PDF goes with it%') as fixed;
