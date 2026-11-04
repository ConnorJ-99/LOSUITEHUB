-- MPS HQ: the Loan Officer Assistant, Phase 1 (Connor, 2026-11-03).
--
-- 1. assistant_chat_messages: each person's saved chats, one thread per
--    borrower file (loan_id) and one general thread (the Assistant page,
--    loan_id empty). A message is what was said plus the cards shown with it.
--    People see, add and clear only their own; a file's thread also needs
--    them to still see the file.
-- 2. assistant_actions: every tool the assistant ran for someone: which
--    tool, on which file, the inputs, the result, the status (pending, done,
--    sent, undone, failed) and, for in-app changes (Phase 2), the values
--    before, so Undo can put them back. Send and Undo work from this table.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ assistant installed").

create table if not exists public.assistant_chat_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid not null default auth.uid(),
  -- Empty = the general thread on the Assistant page.
  loan_id          uuid,
  role             text not null check (role in ('user', 'assistant')),
  body             text not null default '',
  -- Cards shown with the message (borrower lists, summaries, estimates, …).
  cards            jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  -- Typed or spoken.
  via_voice        boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint assistant_chat_messages_organization_id_fkey foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint assistant_chat_messages_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  -- Deleting a file deletes its chats.
  constraint assistant_chat_messages_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade
);

create index if not exists assistant_chat_messages_thread_idx on public.assistant_chat_messages (user_id, loan_id, created_at);

alter table public.assistant_chat_messages enable row level security;
drop policy if exists "people see their own assistant chats" on public.assistant_chat_messages;
create policy "people see their own assistant chats" on public.assistant_chat_messages
  for select to authenticated using (user_id = auth.uid() and (loan_id is null or public.can_see_loan(loan_id)));
drop policy if exists "people add to their own assistant chats" on public.assistant_chat_messages;
create policy "people add to their own assistant chats" on public.assistant_chat_messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
    and (loan_id is null or public.can_see_loan(loan_id))
  );
drop policy if exists "people clear their own assistant chats" on public.assistant_chat_messages;
create policy "people clear their own assistant chats" on public.assistant_chat_messages
  for delete to authenticated using (user_id = auth.uid());

create table if not exists public.assistant_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid not null default auth.uid(),
  loan_id          uuid,
  tool             text not null check (length(trim(tool)) > 0),
  inputs           jsonb not null default '{}'::jsonb,
  result           jsonb,
  status           text not null default 'done' check (status in ('pending', 'done', 'sent', 'undone', 'failed')),
  -- In-app changes: the values before, so Undo can restore them.
  undo             jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint assistant_actions_organization_id_fkey foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint assistant_actions_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  -- Deleting a file keeps the log row, without the file.
  constraint assistant_actions_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id)
);

create index if not exists assistant_actions_user_idx on public.assistant_actions (user_id, created_at desc);
create index if not exists assistant_actions_loan_idx on public.assistant_actions (loan_id);

create or replace trigger assistant_actions_set_updated_at
  before update on public.assistant_actions
  for each row execute function public.set_updated_at();

alter table public.assistant_actions enable row level security;
drop policy if exists "people see their own assistant actions" on public.assistant_actions;
create policy "people see their own assistant actions" on public.assistant_actions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "people log their own assistant actions" on public.assistant_actions;
create policy "people log their own assistant actions" on public.assistant_actions
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
    and (loan_id is null or public.can_see_loan(loan_id))
  );
-- Only the status, result and error change (done → undone, pending → sent, …), never what ran or on whom.
drop policy if exists "people update their own assistant actions" on public.assistant_actions;
create policy "people update their own assistant actions" on public.assistant_actions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.guard_assistant_action()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id or new.user_id is distinct from old.user_id
    -- (loan_id may only become empty: that's the file being deleted.)
    or (new.loan_id is distinct from old.loan_id and new.loan_id is not null) or new.tool is distinct from old.tool or new.inputs is distinct from old.inputs
    or new.undo is distinct from old.undo or new.created_at is distinct from old.created_at then
    raise exception 'An assistant action''s tool, file, inputs and undo values can''t be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_assistant_action on public.assistant_actions;
create trigger guard_assistant_action
  before update on public.assistant_actions
  for each row execute function public.guard_assistant_action();

select
  'MPS HQ assistant installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('assistant_chat_messages', 'assistant_actions')) as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('assistant_chat_messages', 'assistant_actions')) as policies,
  (select count(*) from pg_trigger where tgname in ('guard_assistant_action', 'assistant_actions_set_updated_at')) as triggers;
