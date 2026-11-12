# Employment-driven document requests + upload intelligence (Stage 3)

Status: plan, waiting on Connor (2026-11-12).

## Reused
- Employment on the 1003 (`employments`: employer, start/end date, current/previous, self-employed), whoever entered it (Connor, MISMO import, later the Stage 5 application).
- Suggested conditions (`src/lib/conditions/suggest.ts`, `fileFactsFrom`, `document_rules`, `condition_dismissals`, `loan_conditions.source_key`): computed live, never stored, keyed so nothing is suggested twice. Re-running "when docs arrive or employment changes" is automatic, because nothing is stored.
- The document gatherer ("Request documents", `document_catalog`, `document_requests`, portal links): checked items go to the borrower's checklist and portal.
- Program document rules (`bank_statement_months`, `tax_return_years`) for bank-statement months.
- The contract reader in the `assistant` Edge Function (PDFs/photos to Claude, `ai_runs`, quotes checked, drafts only), `useAiStatus`, and the pg_cron + Vault timer pattern (`scheduled_ghl_send`).

## 3a. Employment rules (pure, tested; one config file `src/lib/conditions/employmentRules.ts`)
- Current W-2 job: pay stubs covering the last 30 days (2) + a W-2 for each calendar year worked there inside the last 2 years.
- Previous W-2 job inside the last 2 years: a W-2 for each calendar year worked there in the window + final pay stub (if available).
- Self-employed full doc: 2 years personal returns (+ business returns when 25%+ owner) + YTD P&L. Bank statement: 12 or 24 months (the program's number, default 12) + CPA letter / business license.
- Other income: the existing award-income rules.
- History checks → suggested conditions: under 24 months covered, gaps over 30 days in the last 2 years (with dates), a start date in the last 6 months (flag for review).
- When a job has no dates, the current "pay stubs / W-2s (2 years)" rules stay as they are.
- Shown in "Request documents" as "Suggested from employment" (unchecked; Connor checks) and in Conditions → Suggested.

## 3b. Upload analysis (AI, drafts only)
- One new table `document_analyses` (one per uploaded document): status queued / analyzing / ready / needs_review / failed, attempts, next try (backoff 1, 5, 30 minutes, 3 tries), error, suggested type + confidence, extracted fields (each with the words it came from), flags. Never changes a type or value Connor set.
- `assistant` Edge Function task `document_read` (no new function); pg_cron every minute runs what's due; "Re-run analysis" on each document; failures show on Today.
- Matching to employment and the mismatch flags are pure code (employer name, dates vs the 1003, pay stub older than 30 days, statement months missing). An employer not on the 1003 becomes "Add this employer?" (Accept writes the job).
- Without the Anthropic key: uploads wait as "Waiting for the AI key", everything else works by hand.

## 3c. Suggested conditions from documents
Missing, expired (pay stub over 30 days), mismatches, gaps and shortfalls join Conditions → Suggested with their reason; Connor checks which to post (existing flow).
