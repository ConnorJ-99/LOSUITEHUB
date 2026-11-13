# Borrower application → MISMO → New Leads (Stage 5)

Status: plan, waiting on Connor (2026-11-13).

## Reused
- Lead intake `intake_web_lead()`: matches by email or 10-digit phone (never by name), new lead / past client = new file linked / open file = note + task, assigned LO else the owner, a `lead_submissions` row (so it shows in Today's web forms), the drafted first text and email.
- The 1003 records (`employments`, addresses, `other_incomes`, assets, liabilities, declarations on the loan, person fields on the contact): the application writes into them; the 1003 tab and MISMO export read them.
- MISMO 3.4 export (`src/lib/mismo/build.ts`, ULAD layout, no SSN) and its checklist.
- Pages' "Proposed updates" pattern (`decide_page_update()`, Overview card): an application on an OPEN file becomes proposed updates to Accept / Reject, never overwrites.
- GHL contact match/create (`ghl` function `page_contact` → `linkContact`, test mode, duplicate search by phone and email).
- Stage 2 portal link (email check, 24-hour session): "Start your application" on the portal; Stage 3a runs on its own once jobs with dates are saved.
- Action Queue drafts (thank-you text and email, built in code, never sent on their own); notifications.

## New
1. `borrower_applications` (one table): answers as typed (jsonb), the step reached, status (in_progress / submitted), a resume token (hash only), the portal link it came from (if any), credit-authorization consent (when, wording version, a one-way IP code), outcome, the contact and loan it landed on, proposed updates (open file), and the saved MISMO document.
2. Edge Function `apply` (Verify JWT off): start / save step / submit, a spam limit like Pages, no SSN anywhere (refused by pattern, as Pages do).
3. `submit_application()` (service role only): runs `intake_web_lead()`, then writes the answers into the 1003 records for a new file, or saves them as proposed updates for an open file (flagged), and flags a matched existing person.
4. `/apply` (standalone, for mps.mortgage, `?lo=` picks the loan officer) and "Start your application" on the portal: phone-first, about 9 short steps, saved as they go.
5. MPS-HQ: "New application" on Today (web forms) and a notification; Overview "Application" card with the answers, Proposed updates (Accept / Reject) and the MISMO file; drafted thank-you text and email.

## Steps (short by default)
Borrower · co-borrower (optional) · contact · current address + housing · employment and income (with dates, 2 years) · assets · debts they know of · the loan (purpose, price range / down payment, state) · citizenship · declarations · credit authorization consent → submit.
