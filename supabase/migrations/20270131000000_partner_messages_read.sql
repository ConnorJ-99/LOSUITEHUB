-- MPS HQ: emails from title and insurance on the file (Connor, 2026-11-14).
--
-- The ghl-inbound function now saves a partner's texts and emails under the
-- partner (messages.partner_id, already there) and the file they're about.
-- This adds the one thing the app can't do itself: marking a partner's
-- messages on a file read when someone opens them.
--
-- Safe to re-run. Ends with a confirmation row.

create or replace function public.mark_partner_messages_read(p_loan_id uuid, p_partner_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.can_see_loan(p_loan_id) then
    return 0;
  end if;
  update public.messages set read_at = now(), read_by = auth.uid()
  where loan_id = p_loan_id and partner_id = p_partner_id and direction = 'inbound' and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_partner_messages_read(uuid, uuid) from public;
do $$ begin
  revoke all on function public.mark_partner_messages_read(uuid, uuid) from anon;
exception when undefined_object then null; end $$;
grant execute on function public.mark_partner_messages_read(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ partner messages on files installed' as result,
  has_function_privilege('authenticated', 'public.mark_partner_messages_read(uuid, uuid)', 'execute') as people_can_mark_read;
