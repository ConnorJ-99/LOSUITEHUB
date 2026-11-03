-- LOSuite: remove GHL history copied onto TEST people (DEV project only).
--
-- Before the test-mode privacy fix (20261206000000_ghl_test_privacy.sql),
-- linking a TEST lead to a real GHL contact copied in that contact's older
-- messages, including GHL's internal "NEW LEAD" alerts with real clients'
-- names and phones. This deletes, on people with TEST in their name who are
-- linked to GHL:
-- - every message from before they were linked (except ones sent from
--   LOSuite), and
-- - every outbound message that wasn't sent from LOSuite (GHL's own
--   workflows and alerts).
-- Replies they sent and messages sent from LOSuite stay. Touches nothing
-- else. Run after the test privacy script. Safe to run more than once. Ends
-- with a confirmation row ("LOSuite test history cleaned").

with test_people as (
  select c.id, c.ghl_linked_at
  from public.contacts c
  where c.ghl_contact_id is not null
    and (c.first_name ~ '\mTEST\M' or c.last_name ~ '\mTEST\M')
),
gone as (
  delete from public.messages m
  using test_people p
  where m.contact_id = p.id
    and m.sent_by is null
    and (m.direction = 'outbound' or m.sent_at < coalesce(p.ghl_linked_at, now()) - interval '5 minutes')
  returning m.id
)
select
  'LOSuite test history cleaned' as result,
  (select count(*) from gone) as messages_removed,
  -- Counted before the delete in the same statement, so the removed ones are taken off.
  (select count(*) from public.messages m join test_people p on p.id = m.contact_id) - (select count(*) from gone) as test_messages_left;
