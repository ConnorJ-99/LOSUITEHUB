# MPS-HQ build: closed dates, homepage cap + Arive link, Add to GoHighLevel, partner stages, comp plans + register, review requests, estimate share links, suggested conditions, lender highlights, AEs and portals, processor review

Connor's plan, saved as written (2026-11-10). Added the same day, before Phase 1: **Phase 0b, lender product updates pasted from email** (see the end of this file).

Read CLAUDE.md first and follow its hard rules. In particular, every SQL script must be safe to re-run, end with a confirmation row and be tested twice in PGlite. RLS goes on every new table. Mortgage and comp math goes in `src/lib/calc/` with Vitest tests. Live clients are on `tlsq`, so make additive changes only: don't rewrite or delete existing loan data.
The matrix tier fix (Phase 0) is done and committed (002b2ef), so don't redo it. Build Phases 1 through 11 below in order, one at a time. At the end of each phase: run the tests, run the app, give me a short click-through checklist, then commit. Stop after each phase and wait for my OK before starting the next.
The new tables and columns in this file are approved: `loan_change_log`, `funding_date`, the partner fields, `lender_comp_plans`, `comp_plan_id`, the comp settings and per-loan comp snapshot, the Arive link setting, the review settings and columns, `estimate_shares`, `estimate_share_events`, the `document_rules` filters and the suggestion dismissals, `highlight_tags`, `lender_highlights`, `lender_links`, the new `lender_contacts` fields and per-LO lender login details (no passwords), `file_reviews`, `file_review_items` and `loan_conditions.kind`. If you think one of them should be built differently, say so before building.

## Phase 1: actual closing and funding dates (bug fix)
Problem: marking a loan Closed only stamps `stage_changed_at`, so a loan that funded Friday and was marked closed Monday reports on Monday.

1. Add the migration `loans.funding_date date` (nullable). Keep `closing_date` as the one closing date. `stage_changed_at` and `loan_stage_history` stay as the system record of when the status was changed. Never make either one editable.
2. Add a new table `loan_change_log`, an append-only audit log written only by a trigger and read-only to users who can see the loan. Columns: loan, field, old value, new value, changed by, changed at, optional reason. The trigger logs changes to `closing_date`, `funding_date`, `revenue_type`, `revenue_value`, the new comp fields from Phase 5, and `assigned_lo_id`.
3. In `useStageChanger`, when the new stage is `closed`, open a dialog before saving. The dialog works like the existing Mark as Lost dialog.
   * It asks for "Closed on" and "Funded on," both defaulting to today, or to the existing `closing_date` if one is set.
   * It has an optional "Reason / note" field.
   * Save writes the dates and the stage together. The GHL opportunity move still happens once and only on the stage change, not when dates are edited later.
4. On a closed file's Overview, show Closed on and Funded on as editable fields, so old loans can be corrected. Editing them must not trigger GHL or anything else. It is logged only.
5. Anywhere that lists or counts closed production, use `funding_date`, then fall back to `closing_date`, then `stage_changed_at` only for old loans with neither date. That includes the closed list and counts, plus the reminder engine if it uses the close timestamp. Add a pure helper `productionDate(loan)` with tests that cover the Friday-funded, Monday-marked example.
6. Leave the bulk closed-client import alone, except that it may fill `funding_date` when a file column provides it.

## Phase 2: homepage cap
On the Today page Priority list (`src/components/queue/PriorityList.tsx`), show only the top 5 items in the existing order: starred, then `sort_order`, then soonest due. Snoozed and completed items stay hidden. Below the list, add a "View all (N)" link that opens the full list, either expanded in place or on its own route, whichever is simpler. No database change.
Also in Phase 2: an Open in Arive link. `loans.arive_loan_number` already exists and is edited in `EditLeadDialog`, but nothing links to Arive.

1. Add one company setting, "Arive loan link," in the Settings company card (owner/admin). It is a URL template containing `{number}`. I'll paste the address of a loan from my browser and swap the loan number for `{number}`. Store it alongside the other company settings; it's a single text column, so it's fine to add. Validate that it starts with `https://` and contains `{number}`.
2. On the borrower profile header and the Overview, show the Arive loan number next to an Open in Arive button. The button opens the template with the number filled in (URL-encoded) in a new tab.
3. If there's no number, show a small "Add Arive #" link that opens the existing edit dialog. If the number exists but the template is blank, show the number with a copy button and the hint "Set the Arive link in Settings."
4. Put it on closed files and in the Phase 5 register too.

## Phase 3: Add to GoHighLevel button
The matching and creation logic already exists: the `ghl` function's `contact` task, `linkGhlContact`, `ensureGhlContact` and the `ghl_calls` log. Reuse it and don't write a second path.

1. Borrower contacts: where a person's details are shown on a file, and on their contact page if there is one, show the following.
   * If `contacts.ghl_contact_id` is empty: an Add to GoHighLevel button. It runs the existing match-or-create, assigned to the file's LO.
   * If linked: a "Linked to GoHighLevel" chip, matching the existing GoHighLevel panel.
   * If it was skipped or failed: the reason and a Retry button.
   * Keep all existing rules. Test mode only touches TEST people, contacts get no tags, nothing is enrolled in a workflow, and anything that hits the shared email/phone or different-people cases goes to Needs matching instead of linking.
2. New Lead dialog: add an optional toggle chip "Add to GoHighLevel after saving" next to "Start prequal call after saving." It is off by default.
3. Partners: add a `partner` path to the `ghl` function's `contact` task. It matches by stored id, then email, then phone, never by name, using GHL's duplicate search. It creates the contact only if no one is found and assigns it to the partner's assigned LO from Phase 4, or to the person clicking. Only the function sets `partners.ghl_contact_id`. Show the same button, chip and Retry in `PartnerDialog`. Log every call in `ghl_calls`.
4. Sync is one-way: MPS-HQ to GHL, on click only. There is no bulk action and no automatic sync.

## Phase 4: Realtor relationship stages
1. Add a migration on `partners`.
   * `stage`: one of identified, contacted, meeting_scheduled, meeting_completed, active, nurture. Existing rows default to `active`.
   * `assigned_lo_id`, a foreign key to profiles with `on delete set null`.
   * `next_follow_up_on date`, `last_met_on date` and `source text` (where they came from).
2. On the Partners page, add a stage filter, a column for the next follow-up date, and a count per stage at the top. `PartnerDialog` gets the new fields.
3. On the Partners page, show each partner's count of referred files and closed files, using the partner links that already exist on files and submissions. Calculate these counts; don't store them.
4. Visibility: admins see all partners. An LO sees every partner, since partners are shared company contacts, but the "My partners" filter defaults to their own. Tell me if you think RLS should be stricter.

## Phase 5: comp settings and closed loan register
Start with lender comp plans (build this part first, then the rest of Phase 5). Today `lenders` only has a free-text `comp_notes`, and loan revenue is typed by hand. Add structured plans so revenue fills itself in from the lender.

1. Add a new table `lender_comp_plans`, approved. Each plan belongs to one lender, with a foreign key using `on delete cascade` and RLS like the catalog: everyone reads, owners and admins edit.
   * Comp type: lender-paid or borrower-paid.
   * Comp % of the loan amount (e.g. 2.750).
   * Minimum $ and maximum $, both optional.
   * Flat fees the lender pays the broker or charges against comp, if any (e.g. a broker admin or processing fee the lender passes through). Keep this simple: a name, an amount, and whether it adds to or subtracts from comp.
   * Effective from / effective to dates, so a lender's comp change doesn't rewrite older loans. Only one plan per lender and comp type can be active on a given date; enforce this in the database.
   * Optional program scope: null means all programs, or a list of specific programs from the catalog for lenders with a different plan on, say, HELOCs or second liens. Show a short note on the screen: "Program-specific comp: confirm with compliance before using."
   * Notes.
2. On the Lenders page, add a Comp plans section on each lender. It lists current and past plans, has an add/edit form, and shows a preview line: "On a $400,000 loan: $11,000." Show the old `comp_notes` text read-only above it, so I can copy each lender's plan into the structured fields. Don't parse it automatically.
3. Add a "Missing comp plan" filter or badge on the Lenders page for signed-up lenders with no active plan, so I can see what's left to enter.
4. Write a pure function `lenderComp(loanAmount, plan)` in `src/lib/calc/` with tests: % only, min floor, max cap, fee add and subtract, and no plan (returns null, not $0).
5. Loan revenue: when a file has a selected lender (from the selected program or estimate) and a loan amount, the Overview revenue field shows the calculated lender comp as a suggested value: "From [Lender] comp plan: $X." Use the plan active on the closing date, or today if there's no closing date. One click applies it to `revenue_type`/`revenue_value`, and I can still type over it. Save which plan was used (`loans.comp_plan_id`, nullable, `on delete set null`) so the register can show the source. The value is never overwritten silently when the loan amount changes; show "Plan figure has changed: update?" instead.
6. The register flags loans whose revenue differs from their lender's plan figure. That catches typos and lender-paid vs. borrower-paid mix-ups.

Then build the company comp settings and the register.

Comp settings, owner/admin only: add a "Compensation" card in Settings.
* Comp base: the dollar figure the split applies to. Options:
   * "Company revenue on the loan" (the existing `revenue_type` / `revenue_value`, i.e. gross company revenue). This is the default.
   * "Loan amount × bps": the admin enters the bps.
* Company-generated lead split %: default 35.25.
* Self-generated lead split %: default 70.25.
* Per team member: comp type is either Commission or Salary-only. For salary-only members, 100% of the commission goes to company overhead.

Store these on the organization or in a small settings table, whichever matches existing patterns, and explain your choice. Changes are logged.

On each loan, shown to admins on the closed file's Overview:
* `lead_source_type`: company or self-generated. It defaults to company when the file came from website intake or Pages, and self-generated otherwise. Only an admin can change it.
* When a loan is closed (Phase 1 dialog), snapshot the comp base, the split % and the comp type onto the loan. Later settings changes then don't rewrite history. An admin can edit the snapshot, and the edit is logged.
* Calculated, never stored: gross revenue, LO comp, and net to company. Write a pure function `loanComp(loan, snapshot)` in `src/lib/calc/` with tests for company, self-generated, salary-only, bps base and missing revenue (show "needs revenue," not $0).

Closed loan register: a new page `/closed-register`. Admins see every loan; an LO sees only their own.
* One row per closed loan: production date (Phase 1 helper), closing date, funding date, borrower, property, LO, lender, program, purpose, occupancy, loan amount, rate, term, Arive loan number, lead source type, gross revenue, LO comp and net.
* Filters: date range, which defaults to this month by funding date, plus LO and lead source type.
* Totals row: count, volume, gross revenue, LO comp and net.
* Export CSV of exactly what's on screen.
* Rows missing a funding date or revenue get a flag, so I can clean up 2026 production.
* Label the page "Operational register, Arive remains the loan record of record." It is read-only except through the existing edit paths.

## Phase 6: review requests after closing
Every closed loan should get a review request. It is drafted, never sent automatically, under the existing rule that nothing sends without a click. Reuse the Action Queue (`action_items` with `source_key`), the existing approval and send path, consent checks and sending hours. Follow the open-house "thanks" drafts as the pattern.

1. Settings (owner/admin), in a "Reviews" card:
   * Company review link, required to turn the feature on. Optionally a second link (e.g. Zillow), shown as "or here."
   * Days after funding to draft the request: default 3.
   * Whether to draft a single follow-up if no review is marked after X days: default on, 7 days. Never more than 2 asks per loan.
   * The text and email wording, with placeholders for first name, LO first name and link. Defaults:
      * Text: "Hi {first}, it's {lo}. Congrats again on closing! If you have a minute, would you leave a quick review of your experience? {link} Thank you!"
      * Email: a short thank-you plus the same ask, with the link as a button.
   * Settings › My profile gets an optional personal review link per LO, used instead of the company link when set.
2. On the loan, add a migration with these columns:
   * `review_status`: not_requested, drafted, requested, follow_up_sent, received, skipped.
   * `review_requested_at`.
   * `review_received_on`.
   * `review_skip`, a boolean labeled "Don't ask for a review" with an optional note, for a file that went badly. All changes go through `loan_change_log`.
3. Drafting: a daily pg_cron job, using the existing scheduler pattern, drafts the request into the Action Queue for each closed loan where all of the following hold:
   * funding date + N days is today or earlier, with closing date as the fallback;
   * status is not_requested and skip is off;
   * the person has consent on at least one channel;
   * the person wasn't asked for a review in the last 12 months (repeat clients). The channel is a text when there is SMS consent, else email. `source_key` is `review:<loan>`, so it can never draft twice. A second key, `review-followup:<loan>`, covers the one follow-up.
4. Don't backfill old loans. Only loans funded on or after the day this ships get drafts. Old closed clients get a manual Request review button on the closed file's Overview, which makes the same draft. There is no bulk action.
5. On the closed file's Overview, show review status with a Mark review received button that records the date and stops any follow-up.
6. Register (Phase 5): add a Review column. On the Today page, add a small "Reviews: X requested / Y received this month" figure; it doesn't count toward the 5-item cap.
7. Compliance:
   * The wording must stay neutral. It must not say "only if you were happy" or similar, which is review gating and is against Google's and the FTC's rules.
   * No incentives for reviews.
   * Keep a comment in the code saying the wording is subject to my compliance review.
8. Tests: the eligibility function (pure, in `src/lib/`) covers days after funding, skip, no consent, a repeat client inside 12 months, the backfill cutoff, and the follow-up limit.

## Phase 7: share estimates with borrowers by link
I want to pick several saved estimates on a file and send the borrower one link by text or email. The borrower opens a branded page comparing the options and unlocks it with their email address. Reuse the existing pieces: saved estimates (`pricing_scenarios`) and their PDF (`useEstimatePdf`), the Pages Phase 3 personal-link pattern (`page_links`: long random token, expiry, revoke, opened tracking), and the existing approval, send, consent and sending-hours path. Write a short plan first and wait for my OK, because this adds a public page and an Edge Function.

1. Database. Add a new table `estimate_shares`, approved.
   * Columns: file, person, chosen estimate ids, token (long, random, same rule as `page_links`), created by, created at, expires at, revoked at, first and last opened at, views count, and picked estimate (see step 5).
   * Snapshot: save a frozen copy of each estimate's numbers at share time. Later edits on the file don't change what the borrower sees; a new share is a new link.
   * RLS follows the file rule. Only the Edge Function reads shares for the public page.
2. Email unlock. Add an `estimate-view` Edge Function with Verify JWT off and a secret pattern like lead intake.
   * The borrower opens `/e/{token}` and types their email.
   * It must match (lowercased, trimmed) the email of a borrower on that file. If it doesn't, they see a generic "We couldn't verify that email." It never reveals whether the email is on file.
   * On a match, the function emails a 6-digit code from the LO's address through the existing GHL email path. The code is valid for 10 minutes, with 5 tries and a limit of 3 codes per hour per share.
   * Verifying returns a short-lived viewing session of 24 hours, so a refresh doesn't need a new code.
   * Log each attempt (share, time, success or failure) in an `estimate_share_events` table, approved.
   * This code email is an automatic send. It is a sign-in code the borrower requests, not a client message. Confirm with me before building it as an exception to "nothing sends without a click." It must never contain loan details. If I say no, fall back to email-match only, with no code.
3. The borrower page, responsive and phone-first, in MPS-HQ branding:
   * The LO card: photo or headshot if one exists, name, NMLS, phone, and a "Text me" / "Email me" button.
   * The options side by side on a computer and swipeable cards on a phone. For each: name, program, rate, APR when the estimate has it, points or credit, loan amount, down payment, principal and interest, full monthly payment (PITI with MI and HOA), estimated cash to close, and an expandable fee breakdown (sections A–H from the estimate).
   * A "Download PDF" button that uses the existing estimate PDF.
   * A fixed disclaimer: "Rates as of {date and time}. Estimates only, not a commitment to lend or a rate lock; rates and fees change daily and depend on final approval," plus company NMLS #2501110 and Equal Housing Opportunity.
   * Never show SSNs, account numbers, credit details, income or anything beyond the estimate figures.
   * After expiry, the page shows only "These rates have expired. Contact {LO} for updated numbers" and the LO card.
4. Sharing from the file. In the Scenarios & Estimate tab's saved estimates, add checkboxes and a Share selected button, up to 5 estimates. The dialog has:
   * recipient: the borrowers on the file with an email;
   * channel: text or email, filtered by consent;
   * expiry: default 7 days, with the default a Settings value;
   * an editable message preview with the link. Default text: "Hi {first}, here are the loan options we went over: {link} You'll confirm your email to open them. Rates as of today and can change. - {lo}" The message goes through the normal approval and Send click; nothing sends from the dialog alone.
5. Borrower actions: an "I'm interested in this one" button on each option. It records the picked estimate on the share, adds a note to the file, and sends the LO an in-app notification using the existing notifications table. It does not message the borrower back or select the estimate on the file; I do that.
6. On the file, add a "Shared estimates" list: date, options, recipient, opened (time and count), the picked option, expiry, a Revoke button, and a Copy link button.
7. Tests:
   * email matching (case, spaces, a co-borrower's email works, a non-borrower's doesn't);
   * code expiry, try and rate limits;
   * expired or revoked shares show nothing;
   * the snapshot doesn't change after the estimate is edited;
   * an LO can't share or see shares on files they can't see.
8. Compliance: add a code comment that the disclaimer, and showing APR alongside rate, are subject to my compliance review.

## Phase 8: suggested conditions on each file
I want MPS-HQ to suggest conditions for a file from its loan type and what's already on the profile, so I can add them to the Conditions tab with a click. Build on what exists; don't make a second system. That means:
* `document_rules`, the editable checklist rules in Settings (`DocumentRulesCard`), with the `document_condition` triggers: wage earner, self-employed, gift and the rest;
* `document_requests` with `RequestChecklist`;
* `src/lib/prequal/documentRules.ts`;
* `loan_conditions`, the Conditions tab;
* the product catalog's `program_rules` and `program_documents`, which carry citations.

Read these first and write a short plan for my OK. The plan should cover what you'll extend versus add, and how document requests and conditions stay in sync, so the same item never shows twice.

1. Rules get loan-type conditions. Extend `document_rules` with optional "Applies when" filters, using the same shape as Smart Fees' "Applies when" if it fits. A rule with no filters keeps working as it does today.
   * Filters: mortgage type (Conventional, FHA, VA, USDA, Non-QM), purpose (purchase, rate/term, cash-out, HELOC/HELOAN), occupancy, property type (condo, 2–4 units, manufactured, new construction), Texas §50(a)(6) cash-out, DSCR / entity vesting, income doc type (full doc, bank statement, 1099, asset depletion), and lender or program (optional).
   * Each rule also gets who it's on (borrower, title, realtor, processor/LO, appraisal), matching `condition_party`, and a when needed stage: application, processing or before closing.
2. Starter rules. Add them to the company starter list, only those not already covered by an existing rule; list any overlaps for me. All are editable and can be turned off in Settings:
   * Purchase: executed contract and addenda, earnest money proof (cancelled check or wire and the account it came from), homeowners insurance quote and agent.
   * Refinance: current mortgage statement, insurance declarations page, payoff authorization.
   * Texas §50(a)(6) cash-out: a processor/LO task to confirm the 12-day notice was delivered and sign-off timing, prior home-equity loan info if any in the last 12 months, and the homestead survey if the title company requires it.
   * HELOC/HELOAN: first-lien mortgage statement.
   * VA: Certificate of Eligibility, DD-214 or statement of service, and the funding-fee exemption letter only when exempt is marked.
   * FHA: none extra beyond the profile rules unless a lender rule says so.
   * USDA: income for every household member.
   * Condo: HOA contact for the questionnaire (title/realtor), master insurance policy.
   * Investment and DSCR: leases or a rent schedule, and for an LLC the articles, operating agreement and EIN letter.
   * Bank statement: 12 or 24 months of business or personal statements matching the program, plus a CPA letter, business license or P&L only when the selected program's rules call for it.
   * From the profile: gift letter plus donor transfer proof when a gift is on the 1003; divorce decree when support income or payments are listed; bankruptcy or foreclosure papers when declared; leases for owned rentals that are being kept.
3. Specific to the file. Where the profile has the detail, the suggestion names it:
   * "2 most recent statements: Chase checking ••1234," one per asset account on the loan, with last 4 digits only;
   * "W-2s 2024–2025 and 30 days of pay stubs: ABC Company," one per job;
   * "2 years tax returns (2024, 2025): Sample LLC." The number of months comes from the rule. If the selected program has a citation in `program_rules` or `program_documents`, that number wins and the citation is shown.
4. Suggestions are calculated, never stored, until accepted. Write a pure function `suggestConditions(fileFacts, rules, existing)` in `src/lib/` with tests. Each suggestion carries:
   * source: "Company rule" (rule name), "Lender guideline" (program and citation), or, later, "AI suggestion";
   * why: e.g. "Gift on the 1003: $15,000 from Mom";
   * party and stage;
   * a stable key (rule plus loan plus, e.g., the asset id), so it's recognized after it's added or dismissed.
5. Conditions tab. Add a collapsible Suggested (N) box above the list. Each suggestion shows its text, why, source and party, with Add (one click), Edit and add, and Dismiss buttons. There's also an Add all button with a confirmation and the count.
   * Added suggestions become normal `loan_conditions` rows, with the key saved so they're never suggested again.
   * Dismissals are saved per loan and key, with an option to undo.
   * A suggestion is hidden when a matching condition already exists, or when a matching document request is already received or reviewed.
   * Nothing is sent to the borrower from here. Condition reminders keep working as they do today, as drafts I approve.
6. When suggestions refresh: whenever the file changes. Examples: the loan type is switched to FHA, a gift is added, or a program is selected. Removed facts make their suggestions disappear, but never delete a condition I already added. Instead, flag it: "No longer matches the file (gift removed)."
7. Later, not now: an AI pass that reads the selected lender's guideline text, with each suggestion citing the passage. Leave the "AI suggestion" source and a `useAiStatus` gate ready, but don't build it.
8. Tests:
   * each starter rule fires and doesn't fire as expected (purchase vs refi, VA exempt vs not, condo, DSCR with an LLC, Texas cash-out);
   * account-specific wording uses last 4 only;
   * a program citation overrides the rule's month count;
   * added and dismissed suggestions don't come back;
   * removing a fact flags the condition instead of deleting it.

## Phase 9: lender highlights ("Best DSCR pricing," "Best conventional pricing")
I want to tag lenders with what they're best at, so I and future LOs know where to go first. Tags are internal only and never shown to borrowers.

1. Database: add two new tables, `highlight_tags` and `lender_highlights`, approved.
   * `highlight_tags` is the company's tag list, edited by owners and admins in Settings or on the Lenders page. Each tag has:
      * a label, e.g. "Best pricing," "Fastest turn times," "Low FICO friendly," "Best for self-employed," "Great AE support";
      * an optional loan category, using the catalog's existing program categories or types. These cover Conventional, FHA, VA, USDA, Jumbo, DSCR, Bank statement, Non-QM, HELOC/HELOAN and so on. "Best pricing" + DSCR shows as Best DSCR pricing;
      * a color, from 4–5 preset tones within the MPS-HQ palette. Starter tags: Best pricing for each category the catalog uses, Fastest turn times, Low FICO friendly, Best for self-employed, Great AE support.
   * `lender_highlights` links a lender to a tag, with:
      * an optional program, for when it's one program and not the whole lender;
      * an optional rank (1 = first choice, 2, 3), so "Best DSCR pricing" can have a first and backup lender;
      * a short note, e.g. "beats others by ~0.125 at 700+ FICO, 75% LTV";
      * reviewed on, a date that defaults to today;
      * who set it. Everyone in the company reads them; owners and admins edit. Use the catalog's RLS pattern.
2. Stale warning: pricing moves, so any highlight whose reviewed-on date is more than 30 days old shows a faded chip with "review." The number of days is a Settings value. A Still true button re-stamps today.
3. Where they show:
   * Lenders page: chips on each lender in `LenderList` and in the detail view, with add, edit and remove. Add a filter by tag, e.g. "show me every lender tagged Best DSCR pricing."
   * Product Search results (`SearchResults` / `ProgramCard`): chips on eligible programs whose lender or program is tagged for that scenario's category. Only show category-matched tags, plus untagged-category ones like "Great AE support." A DSCR search shows "Best DSCR pricing," not "Best conventional pricing."
   * Search order: within the eligible results, sort by rank-1 matching highlight, then rank 2 and 3, then the existing order. Ineligible programs never move up because of a tag. Add a toggle, "Highlights first," which is on by default and remembered per user in browser storage.
   * Scenarios & Estimate: show the same chips next to lender names when picking programs for estimates.
   * Quick view: a small "Go-to lenders" card on the Lenders page grouping rank-1 lenders by category: DSCR → [Lender], Conventional → [Lender], and so on.
4. Highlights never change eligibility, pricing math or comp. They are labels and sort order only.
5. Tests:
   * category matching (a DSCR search shows DSCR tags and general tags, not conventional ones);
   * rank ordering among eligible results only;
   * a program-level highlight beats a lender-level one for that program;
   * the stale threshold;
   * a borrower-facing PDF or share link never includes highlights.

## Phase 10: account executives and broker portal links on every lender
This mostly exists already. `lenders` has one AE (`ae_name`, `ae_phone`, `ae_email`) and `portal_url`. `lender_contacts` holds the scenario desk, broker support, underwriting and closing, shown in `LenderDetailParts` and edited in `LenderDialog`. Fill the gaps; don't rebuild it.

1. More than one AE. Lenders often have a separate AE for agency and for Non-QM/DSCR, and later each LO may have their own. Move AEs into `lender_contacts` as role "Account executive," with a migration that copies each lender's current AE into a contact row. Keep the old columns for one release, then mark them for removal. Add to each contact:
   * an optional covers field, e.g. "Non-QM / DSCR" or "Agency";
   * an optional for LO, for when an AE is assigned to one of our loan officers;
   * a primary flag, one per lender.
2. Broker portal and other links. Add a new table `lender_links`, approved. Each row has a label, a URL and a sort order. Starter labels: Broker portal / login, Pricing engine, Rate sheets, Scenario desk submission, Condition upload, Broker guidelines. Copy the existing `portal_url` in as "Broker portal / login." URLs must start with `https://`.
3. Per-LO portal details, with no passwords ever. Add an optional "My login for this lender" for each LO and lender: username or email, and the broker/company ID or NMLS the lender uses. Only that LO and admins can see it. Never add a password field. Show the hint "Save passwords in your password manager." If a pasted note looks like it contains a password, warn before saving.
4. Quick actions where I need them:
   * on each lender card in `LenderList`: Open portal, plus call, text and email buttons for the primary AE (tel:, sms:, mailto:);
   * on the lender detail page: all AEs and contacts with the same buttons, and all links;
   * on Product Search results and program cards: a small "AE: name · call · portal" line;
   * on a loan file with a selected lender or program, on Overview or Scenarios & Estimate: "Lender: [name] · Open portal · AE [name] call/text/email." If the AE assigned to the file's LO exists, show them; otherwise show the primary AE.
5. Tests:
   * the migration copies existing AEs and portal links exactly once, and re-running it doesn't duplicate;
   * the AE picker prefers the file LO's AE, then the primary;
   * per-LO login details are hidden from other LOs;
   * a password-looking note gets warned.

## Phase 11: processor file review and handoff
I want a structured handoff: the LO gathers the documents and submits the file for review, the processor checks that the documents support what's on the 1003 and returns a standard review, and the LO resolves the review or approves it before the file goes to the lender. This is internal quality control as LOs and processors join, not an underwriting decision.

Build on what exists; don't add separate modules:
* the Documents tab (`DocumentsTab`, `document_kind`, the private `loan-files` bucket);
* document requests and the checklist (`document_requests`, `RequestChecklist`), plus Phase 8's suggested items;
* income worksheets (`income_worksheets`) and the calc library (DTI, PITI, cash to close, reserves);
* the 1003 data;
* the processor role and file teams (`loan_team_members`; a processor sees only files they're on);
* the Conditions tab (`loan_conditions`);
* workflow steps (`loan_steps`), notes and notifications;
* the PDF setup (@react-pdf/renderer, `generated_documents`).

Read these first and write a short plan for my OK. The plan should list what you extend versus add, and the screens.

1. Documents tab: readiness by group. Group the existing checklist into Income, Assets, Credit and liabilities, Property, and Other, each with "2/3 received." The checklist is driven by Phase 8's rules, so it already changes by purchase, refinance, cash-out, HELOC or DSCR. Custom items can still be added. Don't build a second checklist.
2. Submit for processor review. Add a button on the Documents tab and the file header. It opens a dialog:
   * processor: someone on the file's team with the processor role, or "add one";
   * a note to the processor;
   * a list of missing checklist items, with "submit anyway" allowed. Submitting creates a review, notifies the processor, and moves the workflow step if there's a matching one.
   * While I'm solo: an owner or admin can be the reviewer on their own file. The review is then marked "Self-reviewed" everywhere it shows.
3. Database: add two new tables, `file_reviews` and `file_review_items`, approved.
   * `file_reviews`, one row per round: file, round number, submitted by and at, reviewer, status, returned at, LO decision and at, and the LO's note.
      * Status runs submitted → in_review → returned → acknowledged / approved_for_submission, and returns to submitted when the LO sends more documents.
      * Reviewer result is one of: Ready for submission, Additional documentation needed, or LO review required.
   * `file_review_items` holds the reviewer's figures and findings by section: Income, Liabilities, Assets, Eligibility, and Items needed. Each finding has text, a severity (blocker, needs attention, info), its linked documents, and resolved by and at.
   * Snapshot at return: when a review is returned, it is locked. A new round is a new row, and old rounds stay readable, so we always know who reviewed what and when.
   * RLS: the file rule. Only the assigned reviewer, an owner or an admin can edit a review in progress. The LO can comment but can't change the reviewer's figures.
4. The review screen. Add one new section on the file, Review, next to Documents and Conditions, with these parts:
   * Summary bar: reviewed monthly income, monthly liabilities including the proposed housing payment, verified assets and reserves, DTI, LTV/CLTV, and the result badge.
   * LO vs. processor comparison: for income, each debt, assets, cash to close and DTI, show the 1003 figure next to the reviewer's verified figure.
      * Flag any difference over a Settings threshold (default $100/month for income and debts, $1,000 for assets).
      * Before the LO can approve the handoff, they must either accept the reviewer's figure, which updates the 1003 through its normal save, or enter an explanation.
      * The reviewer's figures pull from the income worksheets when one exists, so the math isn't done twice.
   * Findings by section, each with linked documents that open in the existing viewer.
   * Items needed: each one can be added to the Conditions tab with one click as an internal condition, or turned into a document request. Nothing is sent to the borrower from here.
5. Internal vs. lender conditions. Add a migration: `loan_conditions.kind`, either `internal` (before submission) or `lender` (from underwriting). Existing rows become `lender`. Phase 8 suggestions and review items create `internal`; pasted underwriting conditions stay `lender`. The Conditions tab shows the two as separate groups with their own counts. Condition reminders keep working for both.
6. LO actions on a returned review:
   * Acknowledge.
   * Ask a question: a threaded comment on a finding, which notifies the reviewer.
   * Upload or request documents.
   * Resubmit: starts a new round.
   * Approve for submission: only when no blocker is open, every flagged difference is resolved, and the result is Ready for submission. An admin can override with a required note. Approval marks the workflow step and shows "Reviewed by [name] on [date]" on the file header.
7. AI first pass (gated by `useAiStatus`, off until the key is set). When a review is submitted, the assistant reads the uploaded pay stubs, W-2s, bank statements, credit report and mortgage statements. It drafts:
   * extracted income figures;
   * large or unusual deposits, flagged over 50% of monthly income or a Settings figure;
   * debts on the credit report that aren't on the 1003, and the reverse;
   * name, address and employer mismatches. Each draft finding shows which page it came from and is marked AI draft until the reviewer accepts, edits or deletes it. The AI never sets the result, never marks anything eligible and never clears a condition. Log runs in `ai_runs` like the other assistant tasks.
8. Review PDF: one click, using the MPS document templates. It is internal and marked "Internal file review, not an underwriting decision." It contains the summary figures, the comparison and differences, findings, items needed, reviewer and dates, and the round number. It is saved to the file's documents, and a new PDF is made each round.
9. Dashboards:
   * On the processor's Today page: "Reviews waiting" (submitted and in review) with how long each has waited. This goes in the Phase 2 top-5 list when overdue (over 1 business day, a Settings value).
   * On the LO's Today page: "Reviews returned."
   * On the admin pipeline cards: a small review badge.
10. Tests:
   * status flow and locked rounds;
   * only the reviewer can edit figures;
   * the difference threshold and the resolve-before-approve rule;
   * no approval with an open blocker, unless an admin overrides with a note;
   * self-review marking;
   * existing conditions migrate to `lender`;
   * AI drafts can't change the result;
   * a processor can't see files they're not on.

## Not in this build
Lead routing (round-robin, time off, after-hours), the sales manager view, task statuses, the weekly email, and co-branded prequal. Don't start these.

---

## Phase 0b (added 2026-11-10, build before Phase 1): lender product updates pasted from email
Connor's words: "I get emails quite a bit about product updates, so I would like to copy and paste updates that I get to guidelines or products and it matches it to the product and I confirm it."

Scope (to be confirmed with Connor in a short plan first): on the Lenders page, a "Paste a product update" box. Connor pastes the email text; MPS-HQ works out which lender and program(s) it's about and what changes (matrix limits, rules such as max DTI, min FICO, states, reserves, loan amounts, or guideline text), and shows each proposed change next to what's on file today. Nothing changes until he confirms. Confirmed changes go through the existing approve flow as a new matrix version (`approve_matrix_import`, old versions kept, never overwrite an approved version), and guideline text is saved like other guideline documents, with the pasted email kept as the source and quotes checked word for word.
Reuse what exists: `matrix_imports` drafts and the review screen, `matchProgram()`, the reading checks in `supabase/functions/assistant/matrix.ts`, the "Edit limits" draft, `guideline_documents` / passages, and the AI rules (Opus via the `assistant` Edge Function, every run in `ai_runs`, every change with its exact quote). With the AI key off it must still work by hand: pick the lender and program and edit the draft yourself.
Open questions for the plan: whether a new table is needed (e.g. to keep each pasted update and its status), and how an update that only changes guideline text, not limits, is stored.
