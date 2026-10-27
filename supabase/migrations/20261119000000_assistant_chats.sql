-- LOSuite: Product Search "Ask the assistant" chats, Product Search v2 step 9.
--
-- A chat started from a borrower file is kept on that file so it can be
-- reopened: what Connor typed, how the assistant read it, the search it ran
-- and its guideline answers with their citations. Chats with no borrower are
-- not saved. Messages are a record: they can be added or deleted (the whole
-- chat), never edited. Every AI call is also logged in ai_runs.
--
-- Apply to the DEV Supabase project only, after the pre-approval letters
-- script. Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite assistant chats installed").

create table if not exists public.assistant_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  -- Messages with the same chat_id are one conversation.
  chat_id          uuid not null,
  role             text not null check (role in ('user', 'assistant')),
  -- text: what Connor typed; scenario: how a sentence was read; results: a
  -- search that ran; answer: a guideline answer with citations.
  kind             text not null check (kind in ('text', 'scenario', 'results', 'answer')),
  body             text not null default '',
  data             jsonb not null default '{}'::jsonb,
  ai_run_id        uuid,
  search_id        uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  -- Deleting a loan deletes its chats.
  constraint assistant_messages_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint assistant_messages_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint assistant_messages_search_id_fkey
    foreign key (search_id) references public.product_searches (id) on delete set null,
  constraint assistant_messages_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index if not exists assistant_messages_loan_id_idx on public.assistant_messages (loan_id, chat_id, created_at);
create index if not exists assistant_messages_ai_run_id_idx on public.assistant_messages (ai_run_id);
create index if not exists assistant_messages_search_id_idx on public.assistant_messages (search_id);

alter table public.assistant_messages enable row level security;

drop policy if exists "members see chats on permitted loans" on public.assistant_messages;
create policy "members see chats on permitted loans" on public.assistant_messages
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add chat messages on permitted loans" on public.assistant_messages;
create policy "members add chat messages on permitted loans" on public.assistant_messages
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members delete chats on permitted loans" on public.assistant_messages;
create policy "members delete chats on permitted loans" on public.assistant_messages
  for delete to authenticated using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite assistant chats installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'assistant_messages') as chats_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'assistant_messages') as policies;
