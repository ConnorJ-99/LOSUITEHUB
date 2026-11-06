-- MPS HQ: remove TEST Pages and what their test submissions made.
--
-- Deletes every page with TEST in its title, its submissions, views and
-- notifications, and, from those submissions only, the people named TEST
-- (first or last name), their page-made files (referral source "Page · …"),
-- drafts and web-form rows, and partners named TEST. Real people are never
-- touched, even if they used a TEST page. Files visitors uploaded stay in
-- Storage → page-uploads (delete that page's folder there by hand), and GHL
-- contacts made for TEST people stay in GHL (delete them there).
-- Safe to run more than once. Ends with "MPS HQ test pages removed".

create temporary table if not exists tmp_test_pages (id uuid primary key) on commit drop;
create temporary table if not exists tmp_test_subs (id uuid primary key, contact_id uuid, loan_id uuid, partner_id uuid) on commit drop;
create temporary table if not exists tmp_test_people (id uuid primary key) on commit drop;

insert into tmp_test_pages select id from public.pages where title ~* '\mtest\M' on conflict do nothing;
insert into tmp_test_subs select s.id, s.contact_id, s.loan_id, s.partner_id from public.page_submissions s where s.page_id in (select id from tmp_test_pages) on conflict do nothing;
insert into tmp_test_people
  select distinct c.id from public.contacts c
  where c.id in (select contact_id from tmp_test_subs where contact_id is not null)
    and (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ~* '\mtest\M'
on conflict do nothing;

delete from public.notifications where kind = 'page_submission' and source_id in (select id from tmp_test_subs);
delete from public.page_submissions where id in (select id from tmp_test_subs);
delete from public.action_items
  where source_key like 'page:%'
    and loan_id in (select lb.loan_id from public.loan_borrowers lb where lb.contact_id in (select id from tmp_test_people));
delete from public.lead_submissions where external_id like 'page:%' and contact_id in (select id from tmp_test_people);
delete from public.loans l
  where l.referral_source like 'Page · %'
    and exists (select 1 from public.loan_borrowers lb where lb.loan_id = l.id and lb.contact_id in (select id from tmp_test_people))
    and not exists (select 1 from public.loan_borrowers lb where lb.loan_id = l.id and lb.contact_id not in (select id from tmp_test_people));
delete from public.contacts c
  where c.id in (select id from tmp_test_people)
    and not exists (select 1 from public.loan_borrowers lb where lb.contact_id = c.id);
delete from public.partners p
  where p.id in (select partner_id from tmp_test_subs where partner_id is not null)
    and p.name ~* '\mtest\M'
    and not exists (select 1 from public.loan_team_members t where t.partner_id = p.id);
delete from public.pages where id in (select id from tmp_test_pages);

select
  'MPS HQ test pages removed' as result,
  (select count(*) from public.pages where title ~* '\mtest\M') as test_pages_left,
  (select count(*) from public.contacts c join public.lead_submissions s on s.contact_id = c.id where s.external_id like 'page:%' and (c.first_name || ' ' || c.last_name) ~* '\mtest\M') as test_people_left;
