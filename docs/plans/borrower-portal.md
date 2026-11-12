# Borrower portal (Stage 2 of the lender matching + borrower portal spec)

Status: plan, waiting on Connor (2026-11-12). Built on the existing document upload link; no separate app.

## Reused
- `/u/{token}` (`PublicUploadPage`) and the `document-upload` Edge Function (Verify JWT off): email check, 5-wrong lock, 24-hour session, signed uploads into `loan-files`, uploads saved to `loan_documents` with `document_request_id`.
- `document_requests` = the checklist (requested → received → reviewed, rejected, waived), with `instructions` as "why it's needed". Conditions reach the portal through the existing "Request docs" on a condition.
- `loan_milestones` + `loans.stage` for the status stepper.
- `preapproval_letters` and estimate PDFs: both already save to `loan_documents` with `property_id` and `pricing_scenario_id`.
- `properties` (status `interested`), `loans.preapproval_max_price` / `preapproval_max_loan_amount` for the over-limit check.
- Action Queue drafts (`action_items`, `draft_message` with `contactId`) and the send-approval path; `notifications` for "new portal request / upload".
- Build estimates with `?price=&down=` (Stage 1) for "Start numbers" on a request.

## New (needs approval)
1. `document_upload_links.kind` ('request' | 'portal') and `token` (portal links only, readable by people on the file so Copy link works; request links keep hash only). One live portal link per borrower per file; 90 days, "Renew".
2. `loan_documents.published_at` / `published_by`: "Publish to borrower" on letters and estimate PDFs. Nothing shows in the portal unless published.
3. `portal_property_requests`: borrower, file, property, price, down payment ($ or %), wants letter / estimate, notes, over-limit amounts, status (requested → in_progress → ready), handled timestamps. RLS: people who can see the file; inserted only by the Edge Function.
4. `messaging_settings.portal_stage_messages` (jsonb): the one-line message per portal step (Settings).
5. Notification kinds `portal_request`, `portal_upload`.
One script: `20270116000000_borrower_portal.sql`.

## Portal steps (from milestones / stage, pure function `src/lib/portal/status.ts`)
Application received → In review → Submitted to underwriting → Conditions → Clear to close → Closed.

## MPS-HQ side
- Overview: Borrower portal card (link per borrower, Copy, Draft text / email → Action Queue, Turn off, Renew).
- Today: Portal requests card (open property requests with the over-limit flag, new uploads); "Start numbers" opens Build estimates on that home with the price and down payment.
- Publishing a letter / estimate for a home with an open request drafts the "Your numbers for … are ready" text (Action Queue) and marks the request Ready.
