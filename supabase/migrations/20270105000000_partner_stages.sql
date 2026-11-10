-- MPS HQ: Realtor relationship stages (build plan Phase 4).
--
-- partners gains:
--   stage              identified, contacted, meeting_scheduled,
--                      meeting_completed, active or nurture (existing partners
--                      start as active)
--   assigned_lo_id     the loan officer who owns the relationship (cleared if
--                      that person's profile is deleted)
--   next_follow_up_on  the next follow-up date
--   last_met_on        when you last met
--   source             where they came from (open house, referral, ...)
-- Visibility is unchanged: everyone in the company sees every partner (they're
-- shared company contacts); owners, admins and loan officers edit. The
-- Partners page's "My partners" filter starts on the person's own.
-- Referred and closed file counts are worked out on screen, never stored.
-- Apply after the Arive link script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ partner stages installed").

alter table public.partners add column if not exists stage text not null default 'active';
alter table public.partners add column if not exists assigned_lo_id uuid;
alter table public.partners add column if not exists next_follow_up_on date;
alter table public.partners add column if not exists last_met_on date;
alter table public.partners add column if not exists source text;

alter table public.partners drop constraint if exists partners_stage_check;
alter table public.partners add constraint partners_stage_check
  check (stage in ('identified', 'contacted', 'meeting_scheduled', 'meeting_completed', 'active', 'nurture'));

do $$ begin
  alter table public.partners add constraint partners_assigned_lo_id_fkey
    foreign key (assigned_lo_id) references public.profiles (id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists partners_stage_idx on public.partners (organization_id, stage);
create index if not exists partners_assigned_lo_idx on public.partners (organization_id, assigned_lo_id);
create index if not exists partners_follow_up_idx on public.partners (organization_id, next_follow_up_on) where next_follow_up_on is not null;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ partner stages installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'partners' and column_name in ('stage', 'assigned_lo_id', 'next_follow_up_on', 'last_met_on', 'source')) as new_columns,
  (select count(*) from pg_constraint where conname in ('partners_stage_check', 'partners_assigned_lo_id_fkey')) as rules,
  (select count(*) from public.partners where stage <> 'active') as partners_not_active;
