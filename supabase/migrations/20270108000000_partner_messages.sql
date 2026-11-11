-- MPS HQ: texts and emails to realtors and other partners on a file
-- (plan docs/plans/ghl-intros-updates.md, Connor 2026-11-11).
--
-- Until now only borrowers could be messaged. A message can now go to a
-- partner who is on the file's team, through the same approval and send path:
--   send_approvals.partner_id   an approval is for a borrower (contact_id) or a
--                               partner (partner_id), never both
--   approve_partner_send()      like approve_send(): the file's loan officer or
--                               an admin approves one exact message (no
--                               documents, no scheduling) for a partner on
--                               that file's team
--   messages.partner_id         a sent message to a partner, shown to whoever
--                               can see the file it was sent from
-- The ghl function checks the partner's consent, opt-outs, GHL Do Not
-- Disturb, sending hours and test mode exactly as for borrowers.
-- Apply after the comp settings script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ partner messages installed").

alter table public.messages add column if not exists partner_id uuid;
do $$ begin
  alter table public.messages add constraint messages_partner_id_fkey
    foreign key (partner_id, organization_id) references public.partners (id, organization_id) on delete set null (partner_id);
exception when duplicate_object then null; end $$;
create index if not exists messages_partner_idx on public.messages (partner_id, sent_at desc) where partner_id is not null;
-- A matched message belongs to a person or, now, a partner.
alter table public.messages drop constraint if exists messages_matched_has_person;
alter table public.messages add constraint messages_matched_has_person check ((match_status = 'matched') = (contact_id is not null or partner_id is not null));

drop policy if exists "people on the file see its messages" on public.messages;
create policy "people on the file see its messages" on public.messages
  for select to authenticated using (
    (contact_id is not null and public.can_see_contact(contact_id))
    or (partner_id is not null and loan_id is not null and public.can_see_loan(loan_id))
    or public.sees_all_files(organization_id)
  );

alter table public.send_approvals add column if not exists partner_id uuid;
alter table public.send_approvals alter column contact_id drop not null;
do $$ begin
  alter table public.send_approvals add constraint send_approvals_partner_id_fkey
    foreign key (partner_id, organization_id) references public.partners (id, organization_id) on delete cascade;
exception when duplicate_object then null; end $$;
alter table public.send_approvals drop constraint if exists send_approvals_one_recipient;
alter table public.send_approvals add constraint send_approvals_one_recipient check ((contact_id is null) <> (partner_id is null));

create or replace function public.approve_partner_send(
  p_loan_id     uuid,
  p_partner_id  uuid,
  p_channel     public.message_channel,
  p_subject     text,
  p_body        text,
  p_client_key  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_id      uuid;
  v_subject text := case when p_channel = 'email' then nullif(trim(coalesce(p_subject, '')), '') else null end;
  v_old     public.send_approvals%rowtype;
begin
  select organization_id into v_org from public.loans where id = p_loan_id;
  if v_org is null or not public.can_see_loan(p_loan_id) then
    raise exception 'That file was not found, or it is not yours.';
  end if;
  if not public.may_approve_send(p_loan_id, auth.uid()) then
    raise exception 'Only this file''s loan officer or an admin can approve a message on it.';
  end if;
  if not exists (select 1 from public.loan_team_members where loan_id = p_loan_id and partner_id = p_partner_id) then
    raise exception 'That partner is not on this file''s team.';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Write a message first.';
  end if;

  insert into public.send_approvals (organization_id, partner_id, loan_id, channel, subject, body, document_ids, client_key, approved_by)
  values (v_org, p_partner_id, p_loan_id, p_channel, v_subject, trim(p_body), '{}', p_client_key, auth.uid())
  on conflict (organization_id, approved_by, client_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Same key again (a double click or a retry): only the same message counts.
    select * into v_old from public.send_approvals where organization_id = v_org and approved_by = auth.uid() and client_key = p_client_key;
    if v_old.loan_id <> p_loan_id or v_old.partner_id is distinct from p_partner_id or v_old.channel <> p_channel
      or v_old.subject is distinct from v_subject or v_old.body <> trim(p_body) then
      raise exception 'This message changed after it was approved. Refresh the page and approve it again.';
    end if;
    v_id := v_old.id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.approve_partner_send(uuid, uuid, public.message_channel, text, text, text) from public, anon;
grant execute on function public.approve_partner_send(uuid, uuid, public.message_channel, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ partner messages installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('messages', 'send_approvals') and column_name = 'partner_id') as partner_columns,
  (select count(*) from pg_constraint where conname = 'send_approvals_one_recipient') as one_recipient,
  (select count(*) from pg_proc where proname = 'approve_partner_send') as approve_function,
  (select count(*) from pg_policies where tablename = 'messages' and policyname = 'people on the file see its messages' and qual like '%partner_id%') as message_policy;
