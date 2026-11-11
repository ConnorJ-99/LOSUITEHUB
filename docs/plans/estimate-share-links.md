# Phase 7 plan: share estimates with borrowers by link

Approved by Connor 2026-11-11 ("Yes, build it") with the two decisions below.

## What you'll do

1. On **Scenarios & Estimate**, tick up to 5 saved estimates and press **Share selected**.
2. The share box asks:
   * who it's for (borrowers on the file with an email);
   * text or email (only channels they agreed to);
   * how long the link works (7 days by default; the default is a Settings value);
   * the message, prefilled: "Hi {first}, here are the loan options we went over: {link} You'll confirm your email to open them. Rates as of today and can change. - {lo}".
3. **Send** goes through the usual approval and send checks. Nothing goes from the box by itself.
4. On the file, a **Shared estimates** list shows the date, options, who it went to, when and how often it was opened, which option they picked, when it expires, **Revoke** and **Copy link**.

## What the borrower sees (`/e/{link}`)

* They type their email. If it matches a borrower on the file (case and spaces ignored; a co-borrower's email works too), the page opens and stays open on that device for 24 hours. If not, they only see "We couldn't verify that email." It never says whether an email is on file. After 5 wrong emails in an hour the link waits an hour.
* The page is in MPS-HQ branding and phone-first: options side by side on a computer, swipeable cards on a phone. It shows:
  * your card: photo if you have one, name, NMLS, phone, and Text me / Email me;
  * for each option: name, program, rate, points or credit, loan amount, down payment, principal and interest, the full monthly payment (taxes, insurance, MI, HOA), estimated cash to close, and the fee breakdown (sections A–H) folded under a button.
* **Download PDF:** the estimate PDF made when you shared, so it matches the page.
* A fixed footer: "Rates as of {date and time}. Estimates only, not a commitment to lend or a rate lock; rates and fees change daily and depend on final approval," with NMLS #2501110 and Equal Housing Opportunity.
* **I'm interested in this one** on each option: it records the pick, adds a note on the file and sends you an in-app notification. It doesn't message them back or select the estimate on the file; you do that.
* After the link expires or is revoked, the page shows only "These rates have expired. Contact {LO} for updated numbers" and your card.
* Never shown: SSN, account numbers, credit, income, or anything beyond the estimate figures.

## How it's built

* **Database** (one script, approved tables):
  * `estimate_shares`: file, person, the chosen estimates, a 64-character random token (like the Pages personal links), who and when, expiry, revoked, first and last opened, view count, the picked option, the PDF made when sharing, the current code (stored hashed, with its expiry and tries) and the current 24-hour session (hashed).
  * **Frozen copy:** each estimate's numbers are saved on the share when it's sent, so later edits on the file don't change what the borrower sees. A new share is a new link.
  * `estimate_share_events`: every email check, code sent, code tried, open and pick, with time and success or failure (for the limits and your record).
  * RLS follows the file rule. Only the Edge Function reads shares for the public page.
* **Edge Function `estimate-view`** (Verify JWT off, like page-submit): check email → send code; check code → 24-hour session; load the page; record a pick. It uses the token in the link and the session; nothing else is public.
* **The public page** loads on its own like `/p/{slug}` (no app, no sign-in), with a 404 for a bad link.
* **Pure, tested code** for the frozen copy, email matching, the code rules and expiry.

## Tests

Email matching (case, spaces, co-borrower yes, non-borrower no); code expiry, 5 tries and 3-an-hour; expired and revoked shares show nothing; the frozen copy doesn't change after the estimate is edited; an LO can't share or see shares on files they can't see (PGlite); plus the usual script runs.

A code comment notes that the disclaimer, and showing APR beside the rate, are subject to your compliance review. (Saved estimates don't carry an APR today, so the page shows APR only where an estimate has one.)

## Connor's decisions (2026-11-11)

1. **No sign-in code.** Nothing is sent automatically: the page opens when the typed email matches a borrower on the file (case and spaces ignored; a co-borrower's email works). A wrong email shows only "We couldn't verify that email." To slow guessing, a link allows 5 wrong emails an hour, then waits. A match opens the page on that device for 24 hours. The code columns and code tests are dropped.
2. **Links in texts are allowed for estimate shares only.** Every other text still never carries a link.
