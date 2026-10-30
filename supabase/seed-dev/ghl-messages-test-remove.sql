-- LOSuite: remove the SAMPLE GHL messages (DEV project only).
--
-- Deletes everything supabase/seed-dev/ghl-messages-test.sql added: the
-- "seed-test-" messages, the TEST file it made, and Jordan TEST and Maya TEST
-- (with their consent history). Touches nothing else. Safe to run more than
-- once. Ends with a confirmation row ("LOSuite sample messages removed").

delete from public.messages where ghl_message_id like 'seed-test-%';
delete from public.loans where referral_source = 'TEST sample messages';
delete from public.contacts where email in ('jordan.test@example.test', 'maya.test@example.test') and last_name = 'TEST';

select
  'LOSuite sample messages removed' as result,
  (select count(*) from public.messages where ghl_message_id like 'seed-test-%') as messages_left,
  (select count(*) from public.contacts where email in ('jordan.test@example.test', 'maya.test@example.test')) as test_people_left;
