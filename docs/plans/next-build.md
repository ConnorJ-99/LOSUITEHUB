# Next build plan (Connor, 2026-11-02)

## Context
- Nurture clients (didn't continue, couldn't complete, no answer, went elsewhere) stay in GHL only. They are not imported into LOSuite.
- Closed clients are in LOSuite and in GHL's "Closed" pipeline.
- One person = one GHL contact and ONE GHL opportunity, but they can have several loans in LOSuite.

## Decisions
1. Scheduler: approved. Use Supabase pg_cron + pg_net calling Edge Functions with a secret.
2. GHL Closed pipeline: pipeline "Closed", stage "Recently Closed". Look both up by name through the GHL API (GET /opportunities/pipelines) and save their ids. Add a Settings → GoHighLevel picker, so names aren't hard-coded.
3. One opportunity per person. Marking a loan Closed in LOSuite moves the person's existing GHL opportunity to Closed / Recently Closed, or creates one if none exists. "Copy to a new lead" on a closed client (refi or another purchase) moves that SAME opportunity to the active pipeline and stage chosen in Settings. It never creates a second opportunity.
4. Nothing in GHL fires on the Closed pipeline.
5. Weekly email: Connor writes the topics in LOSuite (a topics library). Each week, LOSuite drafts one batch using the next unused topic and Connor approves the batch with one click. It goes to closed clients with email consent, ONE email per person even with several loans, and includes an unsubscribe link that turns off email consent. It does NOT count toward the 2-a-week automated cap.
6. Key dates (birthday, anniversary, insurance renewal, first payment, homestead, holidays): follow ghl-messaging.md Step D. A per-client "automate" switch sends at 10 AM on the day, within consent and sending hours, max 2 a week. Everything else waits in the Action Queue.
7. Prequal results (defaults; Connor may change): a "Send prequal results" button on the Prequal tab after Save, for hand-entered leads and website leads. It matches or creates the GHL contact (assigned to the LO's GHL user), then drafts an email with a one-page Prequal Results PDF for Connor to proofread and edit before he sends it. The PDF shows estimated buying power, estimated payment, loan type, down payment, cash needed and next steps. It says "pre-qualified", and shows no rates. After the email sends, it drafts a text to the Action Queue: "Hey [first name], thanks for the phone call today. I just sent your prequalified results to your email. This is our work number, but you're welcome to reach me on my personal cell too: [LO personal cell]." Add a personal cell field per LO in Settings.
8. Conditions tab (tracking only, no uploads): each condition is a row with its text, who it's on (borrower, title, realtor, processor/LO, appraisal), status (Outstanding, Requested, Received, Submitted, Cleared, Waived), due date and notes. "Paste conditions" splits a pasted list into rows. When every condition is Submitted, Cleared or Waived, the Workflow step "Submit conditions" is marked done. File cards show "X of Y cleared". Reminders (Session 4) go to borrowers only, a draft every 3 days while a borrower condition is outstanding.
9. Loans tab on closed files: lists every loan the person is on (closed, open, lost), each one clickable, with "Copy to a new lead" on each row. No new tables.

## Sessions (do ONE per chat, in order)
- Session 1: ghl-messaging.md Step A (test-mode privacy fix); Loans tab; Conditions tab (list, statuses, paste, workflow tie-in; no reminders yet).
- Session 2 (built 2026-11-02, `20261214000000_ghl_scheduler_opportunities.sql`): pg_cron scheduler + ghl-messaging Phase 2c (scheduled catch-up); GHL contact create + assign to the LO; GHL opportunities (decisions 2–3; scopes `opportunities.readonly` and `opportunities.write`); email with PDF attachment (Step B).
- Session 3 (built 2026-11-02, `20261215000000_prequal_results.sql`): prequal results (decision 7).
- Launch: migrate old data + switch the website forms to lead-intake on the same day. Before then, compare the live mps.mortgage form payload with lead-intake/normalize.ts and list any mismatches. Prepared 2026-11-02 (`20261216000000_launch_intake.sql`): form check, fixes, migration builder and cutover-day steps in `docs/plans/launch.md`. Waiting on Connor: `loan-sweet-intake`'s code and the export files.
- Session 4: drafting engine: key-date drafts + automate switch (decision 6), condition reminder drafts (decision 8).
- Session 5: weekly email (decision 5).

## Still open (Connor)
- Active pipeline and stage for a closed client who comes back: picked in Settings → GoHighLevel pipelines from GHL's list (built in Session 2; Connor picks it).
- Prequal results content and scope: the defaults in decision 7 unless Connor changes them (Session 3).
- Condition reminders: borrowers only until the partner center is used for them, every 3 days while outstanding (Session 4).
- GHL token scopes for opportunities: `opportunities.readonly` and `opportunities.write` (confirmed from GHL's API spec in Session 2; Check connection tests both).
- Does anything in GHL fire on Contact Created? LOSuite now creates contacts (no tags) when someone is first messaged or their loan closes.
