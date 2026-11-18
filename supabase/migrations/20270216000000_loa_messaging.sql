-- MPS HQ: Loan Officer Assistant, step 3 (Connor, 2026-11-17).
--
-- Sending as an LO Assistant: the file's attached LOA (loan_team_members.role
-- = 'loa') may now approve a message on that file, like its loan officer or
-- an admin (may_approve_send). The ghl function then sends it from the LOA's
-- own GHL number (or email), against the borrower's GHL contact, which stays
-- the loan officer's. Every other check is unchanged and still runs on send;
-- nothing sends without a person pressing Send. A file's processor still
-- drafts for the loan officer (draft_for_lo).
--
-- Replies: a borrower's text or email on a file notifies its loan officer AND
-- its LO Assistant ("Maria texted you"), one unread notice per client each. The
-- message itself is on the file's thread and in both people's Inbox already,
-- since both can see the file.
--
-- Needs 20270215000000_loa_files.sql first. Safe to run more than once. A full
-- run ends with a confirmation row ("MPS HQ LO assistant messaging installed").

-- ---------------------------------------------------------------------------
-- 1. Who may approve a message on a file: its LO, its LO Assistant, or an admin
-- ---------------------------------------------------------------------------

create or replace function public.may_approve_send(p_loan_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.loans l
    join public.organization_members m on m.organization_id = l.organization_id and m.user_id = p_user
    where l.id = p_loan_id
      and (l.assigned_lo_id = p_user
        or m.role = 'admin'
        or exists (select 1 from public.loan_team_members t where t.loan_id = l.id and t.profile_id = p_user and t.role::text = 'loa'))
  );
$$;

revoke all on function public.may_approve_send(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Replies notify the loan officer and the file's LO Assistant
-- ---------------------------------------------------------------------------

create or replace function public.messages_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_user uuid;
  v_admin uuid;
  v_open uuid;
  v_count integer;
  v_title text;
  v_link text;
  v_preview text := left(regexp_replace(coalesce(case when new.channel = 'email' and new.subject is not null then new.subject || ': ' else '' end || new.body, ''), '\s+', ' ', 'g'), 140);
begin
  if tg_op = 'INSERT' and new.direction = 'inbound' then
    if new.match_status = 'matched' and new.contact_id is not null then
      select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
      -- One client at a time, so texts arriving together share one notification.
      perform pg_advisory_xact_lock(hashtext('reply-notify:' || new.contact_id::text));
      -- Their unread texts since our last reply.
      select count(*) into v_count from public.messages i
      where i.contact_id = new.contact_id and i.direction = 'inbound' and i.read_at is null
        and i.sent_at > coalesce((select max(o.sent_at) from public.messages o
          where o.contact_id = new.contact_id and o.direction = 'outbound' and public.is_real_reply(o.status)), '-infinity'::timestamptz);
      v_title := coalesce(nullif(v_name, ''), 'A client') || case when new.channel = 'text' then ' texted you' else ' emailed you' end
        || case when v_count > 1 then ' (' || v_count || ')' else '' end;
      v_link := case when new.loan_id is not null then '/loans/' || new.loan_id || '?tab=messages' else '/inbox' end;
      for v_user in
        select l.assigned_lo_id from public.loans l where l.id = new.loan_id and l.assigned_lo_id is not null
        union
        select t.profile_id from public.loan_team_members t where t.loan_id = new.loan_id and t.role::text = 'loa' and t.profile_id is not null
      loop
        v_open := null;
        select n.id into v_open
        from public.notifications n
        join public.messages m on m.id = n.source_id
        where n.user_id = v_user and n.kind = 'reply' and n.read_at is null and m.contact_id = new.contact_id
        order by n.created_at desc
        limit 1;
        if v_open is not null then
          update public.notifications
          set title = left(v_title, 200), body = left(v_preview, 500), link = v_link, created_at = now()
          where id = v_open;
        else
          perform public.notify_user(new.organization_id, v_user, 'reply', v_title, v_preview, v_link, new.id);
        end if;
      end loop;
    elsif new.match_status = 'needs_matching' then
      for v_admin in select user_id from public.organization_members where organization_id = new.organization_id and role = 'admin' loop
        perform public.notify_user(new.organization_id, v_admin, 'needs_matching', 'A message needs matching',
          coalesce(new.ghl_contact_name, new.ghl_contact_phone, new.ghl_contact_email, 'Unknown sender') || ': ' || v_preview, '/inbox', new.id);
      end loop;
    end if;
  end if;
  if new.direction = 'outbound' and new.status = 'failed' and new.sent_by is not null
    and (tg_op = 'INSERT' or old.status is distinct from 'failed') then
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
    perform public.notify_user(new.organization_id, new.sent_by, 'send_failed',
      'Not sent: ' || case when new.channel = 'text' then 'text' else 'email' end || ' to ' || coalesce(nullif(v_name, ''), 'a client'),
      coalesce(new.send_error, 'GHL reports it failed.'), case when new.loan_id is not null then '/loans/' || new.loan_id || '?tab=messages' else '/inbox' end, new.id);
  end if;
  return null;
exception when others then
  raise warning 'Notification not made for message %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.messages_notify() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ LO assistant messaging installed' as result,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'may_approve_send' and prosrc like '%''loa''%') as loa_can_approve,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'messages_notify' and prosrc like '%''loa''%') as loa_notified,
  (select count(*) from pg_trigger where tgname = 'messages_notify') as triggers;
