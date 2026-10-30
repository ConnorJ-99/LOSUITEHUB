-- LOSuite: SAMPLE GHL messages for trying the Messages screens (DEV project only).
--
-- Adds one TEST purchase file, "Jordan TEST" with co-borrower "Maya TEST" on
-- the same mobile number, assigned to the owner, with a few made-up texts and
-- an email (one unread). Also adds three waiting "Needs matching" messages
-- (only the admin login sees those), and marks Maya's email as opted out so
-- "Restore email" can be tried. Nothing is sent and GHL isn't touched: the ids
-- are fake and start with "seed-test-".
--
-- Not a migration: never run this on production. Run after the GHL message
-- senders script. Safe to run more than once (it adds the samples only if
-- they aren't there). Ends with a confirmation row ("LOSuite sample messages
-- installed").
--
-- To remove everything it added, run supabase/seed-dev/ghl-messages-test-remove.sql.

do $$
declare
  org uuid;
  owner_id uuid;
  jordan uuid;
  maya uuid;
  loan uuid;
begin
  -- The company that owns the GHL sub-account (set by Check connection), else the owner's first company.
  select organization_id into org from public.messaging_settings where ghl_location_id is not null limit 1;
  if org is null then
    select organization_id into org from public.organization_members where role = 'owner' order by created_at limit 1;
  end if;
  if org is null then raise exception 'No company found. Run supabase/seed.sql first.'; end if;
  if exists (select 1 from public.messages where organization_id = org and ghl_message_id like 'seed-test-%') then
    raise notice 'Sample messages are already installed.';
    return;
  end if;
  select user_id into owner_id from public.organization_members where organization_id = org and role = 'owner' order by created_at limit 1;

  insert into public.contacts (organization_id, first_name, last_name, email, phone, sms_consent, email_consent)
  values (org, 'Jordan', 'TEST', 'jordan.test@example.test', '(214) 555-0198', true, true) returning id into jordan;
  insert into public.contacts (organization_id, first_name, last_name, email, phone, sms_consent, email_consent, email_opted_out_at)
  values (org, 'Maya', 'TEST', 'maya.test@example.test', '(214) 555-0198', true, false, now() - interval '3 days') returning id into maya;
  insert into public.consent_events (organization_id, contact_id, channel, change, source)
  values (org, maya, 'email', 'opted_out', 'ghl_dnd');

  insert into public.loans (organization_id, purpose, stage, referral_source, assigned_lo_id)
  values (org, 'purchase', 'pre_approved', 'TEST sample messages', owner_id) returning id into loan;
  insert into public.loan_borrowers (loan_id, contact_id, organization_id, role) values (loan, jordan, org, 'primary'), (loan, maya, org, 'co_borrower');

  insert into public.messages (organization_id, contact_id, loan_id, channel, direction, subject, body, from_address, to_address, status, sent_at,
                               ghl_message_id, ghl_conversation_id, ghl_contact_id, match_status, matched_by, read_at, ghl_contact_name, ghl_contact_email, ghl_contact_phone)
  values
    (org, jordan, loan, 'text', 'outbound', null, 'Hi Jordan, your pre-approval is done! Want me to email the letter?', null, null, 'delivered', now() - interval '1 day 2 hours',
     'seed-test-1', 'seed-test-conv-j', 'seed-test-ghl-jordan', 'matched', 'email', null, 'Jordan TEST', 'jordan.test@example.test', '+12145550198'),
    (org, jordan, loan, 'text', 'inbound', null, 'Yes please! Can you email it? We''re looking at a place in Frisco this weekend.', null, null, 'delivered', now() - interval '1 day 1 hour',
     'seed-test-2', 'seed-test-conv-j', 'seed-test-ghl-jordan', 'matched', 'email', now() - interval '1 day', 'Jordan TEST', 'jordan.test@example.test', '+12145550198'),
    (org, jordan, loan, 'email', 'outbound', 'Your pre-approval letter — MPS Mortgage', 'Hi Jordan,' || chr(10) || 'Attached is your pre-approval letter. When you find the one in Frisco, send me the address and I''ll update the letter to match your offer.',
     'Connor <connor@example.test>', 'jordan.test@example.test', 'opened', now() - interval '1 day 35 minutes',
     'seed-test-3', 'seed-test-conv-j', 'seed-test-ghl-jordan', 'matched', 'email', null, 'Jordan TEST', 'jordan.test@example.test', '+12145550198'),
    (org, jordan, loan, 'text', 'inbound', null, 'We put in an offer on 4812 Willow Bend! Seller wants the letter for $410k. Also do you know a good inspector?', null, null, 'delivered', now() - interval '20 minutes',
     'seed-test-4', 'seed-test-conv-j', 'seed-test-ghl-jordan', 'matched', 'email', null, 'Jordan TEST', 'jordan.test@example.test', '+12145550198');

  insert into public.messages (organization_id, channel, direction, body, status, sent_at, ghl_message_id, ghl_conversation_id, ghl_contact_id,
                               match_status, match_reason, candidate_ids, ghl_contact_name, ghl_contact_email, ghl_contact_phone)
  values
    (org, 'text', 'inbound', 'Hi, is this the mortgage guy? My friend gave me your number.', 'delivered', now() - interval '3 hours',
     'seed-test-5', 'seed-test-conv-s', 'seed-test-ghl-sam', 'needs_matching', 'no_match', '{}', 'Sam TEST', null, '+14695550177'),
    (org, 'text', 'inbound', 'Looking to buy around $350k in McKinney.', 'delivered', now() - interval '2 hours 50 minutes',
     'seed-test-6', 'seed-test-conv-s', 'seed-test-ghl-sam', 'needs_matching', 'no_match', '{}', 'Sam TEST', null, '+14695550177'),
    (org, 'text', 'inbound', 'This is the other one of us — can you send it to me too?', 'delivered', now() - interval '1 hour',
     'seed-test-7', 'seed-test-conv-h', 'seed-test-ghl-household', 'needs_matching', 'shared_phone', array[jordan, maya], 'TEST Household', null, '+12145550198');
end;
$$;

select
  'LOSuite sample messages installed' as result,
  (select count(*) from public.messages where ghl_message_id like 'seed-test-%') as messages,
  (select count(*) from public.messages where ghl_message_id like 'seed-test-%' and match_status = 'needs_matching') as needs_matching,
  (select count(*) from public.contacts where email in ('jordan.test@example.test', 'maya.test@example.test')) as test_people;

