# Pages: forms, landing pages and open house sites (plan, 2026-11-06)

Connor's request: a "Pages" sidebar item for building quick borrower forms, landing pages and open house sites (with a printable flyer). Every submission becomes a lead in MPS-HQ. Mockups: `docs/design-reference/pages/`. They use green; the build keeps MPS-HQ's own navy and blue and reuses its cards, tables, chips and inputs, so nothing existing is restyled.

Built in three phases, Phase 1 first and shown to Connor before Phase 2.

## What gets reused

- **Lead intake.** A page submission runs through the same `intake_web_lead()` the website forms use: the same duplicate check (email or 10-digit phone), the same "open file → note + follow-up task, nothing overwritten", the same new-lead path, the same text-consent rule, and it lands in `lead_submissions`, so it shows in Today's web forms list and on the file's Overview like any website lead.
- **GHL.** The `ghl` function's existing contact matching (`ensureGhlContact`: stored link, else GHL's own match, else a new contact assigned to the LO's GHL user, no tags; test mode only touches TEST people).
- **Drafts.** The follow-up text and email go into the file's Action Queue (`action_items`) like every other draft. Nothing sends until Connor clicks Send, Edit, Schedule or Dismiss.
- **Notifications.** The bell and phone push (`notifications`, made by a database trigger).
- **Profile.** The LO card fills itself from Settings → My profile (name, NMLS, phone, email, photo).
- **Phase 2:** Partners (listing agent), the payment math in `src/lib/calc/`, @react-pdf/renderer and `qrcode-generator` (both already approved) for the flyer.

## New pieces that need Connor's OK (Phase 1)

1. **`pages` table.** One row per page: owner, type (form, landing page, open house), title, web address (slug, unique), Draft or Published, the blocks (the page's content as a list), settings (success message or redirect, tags, notifications on/off, SEO title and description, share image), the property (open houses, Phase 2), view count, dates.
2. **`page_submissions` table.** One row per submission: the page, the answers, uploaded files, which person and file it matched or created, the link to the `lead_submissions` row, UTM/source, tags, a scrambled IP (a one-way code, never the real address, used only for the spam limit), and the proposed updates (see 5).
3. **`page_view_days` table.** Views per page per day (page, day, count), so the list can show "Views · 30 days" and Phase 3 can draw the 30-day chart. No visitor details are kept.
4. **Two storage buckets.** `page-assets` is **public** (images on pages, share images, and a copy of the LO's headshot when a page with an LO card is published), because visitors with no login have to see them. `page-uploads` is **private** (files visitors upload, like pay stubs); only the page owner and admins can open them.
5. **Proposed updates.** When a form maps an answer to a borrower field (price, down payment, credit range, timeline…), a brand-new lead gets the answers it has no value for; a person who already has a file gets nothing changed. The file shows "Proposed updates from [page]" with Accept / Reject per field instead (a small database function writes the field only when Connor clicks Accept).
6. **`page-submit` Edge Function** (Verify JWT **off**, like `lead-intake`, with its own checks): checks the page is published, the hidden honeypot field is empty, and the same IP hasn't sent more than 5 submissions in 10 minutes; checks required fields and drops anything that looks like an SSN or full date of birth; hands out one-time upload links for file fields; then runs the steps above.
7. **A small addition to the `ghl` function**: a server-to-server "page contact" task, protected by the same key the every-minute send timer uses, that runs the existing contact matching for the new or matched person. Connor redeploys `ghl` once.
8. **Notification kind "Page submission"** (Settings → Notifications can turn it off, like the others).
9. **Link previews.** Facebook, iMessage and Google don't run the app's code, so a shared `/p/…` link would show "MPS HQ" with no picture. A tiny Vercel function answers `/p/{slug}` with the page's own title, description and share image in the page head, then loads the normal page. (Optional: without it, pages still work, links just preview generically.)

**Tags:** MPS-HQ has no tags today. Proposal: the page's tags (plus the page name) are saved on each submission and shown with it on the file; the new lead's referral source reads "Page · {page name}". No new tag column on people unless Connor wants one.

**Follow-up draft:** written by Claude (the same way reply drafts are) when the Anthropic key is set, else the same template as website leads. Drafts only, either way.

## Rules

- Public address: `/p/{slug}` on the app's own domain, no login. A draft or unknown slug shows "Page not found" (404).
- Field types: short text, long text, email, phone, number, currency, dropdown, choice (radio), checkboxes, date, yes/no, file upload. **No SSN or date-of-birth field types**, and answers that look like an SSN are dropped by the server.
- Who sees what: anyone can read a **published** page; visitors can only submit through `page-submit`. Signed-in people see and edit only pages they own; the **admin** role sees all (the same rule as files).
- Every page footer: MPS Mortgage LLC · NMLS #2501110 · Equal Housing Opportunity.
- Database script: re-runnable, ends with a confirmation row, PGlite-tested (twice, and partial then full).

## Phase 1 screens

- **Pages** list (mockup "Pages list"): stat cards, search, type filter chips, table (title, type, Draft/Published, views, submissions, owner, updated), "Start from a template" cards.
- **Builder** (mockup "Form builder"): blocks on the left, live preview in the middle with Phone/Desktop, the selected block's settings on the right; drag to reorder, duplicate, delete; saves on its own. On a phone: one column with a Preview button. Page settings in a dialog.
- **Submissions** per page: table, open one, link to the file, CSV export.
- **Public page** (mockups "Live form" and "Form submitted").
- **Templates:** Quick Pre-Qual, Borrower Info Request, Document Upload, Refi Interest, Realtor Partner Sign-Up, Contact/Callback.

## Phase 2 (after Connor sees Phase 1)

Open House property panel, financing table (Conventional 5%, FHA 3.5%, VA 0%, one custom; existing calc), visitor sign-in → leads tagged "Open House – {address}" linked to the listing agent, the one-page Letter flyer PDF with a QR code, the phone quick action, and the after-event summary with "draft follow-ups".

## Phase 3

Personal links from a borrower profile (`?t=` token, prefilled, tied to that person), per-page analytics, duplicate / archive / save as my template.
