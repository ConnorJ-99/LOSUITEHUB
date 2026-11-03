-- LOSuite: reminder drafts (next build Session 4; docs/plans/next-build.md
-- decisions 6 and 8).
--
-- contacts.automate_reminders: the per-client "Automate reminders" switch on
-- a closed file. When it's on, LOSuite drafts the client's key-date reminders
-- (birthday, anniversary, holidays, insurance renewal, first payment,
-- homestead) in the Action Queue on the day. Off by default. Nothing sends
-- without a click.
--
-- action_items.source_key: what a draft was made for (e.g.
-- "keydate:<loan>:anniversary:2026-03-15" or "conditions:<loan>:2026-11-04"),
-- unique per company, so the same reminder is never drafted twice. Older items
-- have none.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite reminder drafts installed").

alter table public.contacts
  add column if not exists automate_reminders boolean not null default false;

alter table public.action_items
  add column if not exists source_key text;

-- Not partial, so the app can insert with "on conflict do nothing"; rows with
-- no key don't collide (nulls are distinct).
create unique index if not exists action_items_source_key_idx
  on public.action_items (organization_id, source_key);

select
  'LOSuite reminder drafts installed' as result,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'contacts' and column_name = 'automate_reminders')
        or (table_name = 'action_items' and column_name = 'source_key'))) as new_columns,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'action_items_source_key_idx') as indexes;
