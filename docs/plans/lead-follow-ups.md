# Lead "Next Action" tags + suggested follow-ups (leads only)

Connor's spec, 2026-11-16. Step 1 (audit + plan). Nothing is built yet; waiting on his OK and the decisions at the end.

## What exists today (audit)

**Lead stages and when a lead becomes an active loan.** One config, `src/lib/pipeline/pipelines.ts`. Purchase: New lead (`lead`, `contacted`) → Prequal (`pre_qualified`) → Pre-approved (`pre_approved`, `home_search`) → Under contract → Processing → … Refinance and HELOC: New lead → Quoted (`pre_qualified`, `pre_approved`, `home_search`) → Application (`under_contract`) → … A lead becomes an active loan when Connor moves it to Under contract / Application (drag or stage change; nothing moves on its own). Nurture and Lost are their own stages. **This feature covers files in `lead`, `contacted`, `pre_qualified`, `pre_approved`, `home_search` only.**

**Time frame.** `loans.timeline` (text) is filled by the website forms (`lead-intake/normalize.ts`: timeline / timeframe / when), the online application (`apply_application()`, only when blank), the Prequal tab and the card's chip. `loans.ready_on` (2026-11-14) is the date worked out from it (trigger `loans_set_ready_on`); cards show "Ready Feb 2027 · 3 months" / "Ready now" / "Time frame?".

**1003 application status.** Only the online application tracks it: `borrower_applications.status` = `in_progress` (started) or `submitted`; no row = not started. A 1003 Connor types himself (phone, MISMO import) has no status.

**Documents and conditions.** Two lists on Docs & Conditions:
- `document_requests` (the borrower checklist): `requested` → `received` → `reviewed`, or `rejected`, `waived`. Item names are plain words from `document_catalog` / `document_rules` (e.g. "Pay stubs (last 30 days)", "W-2s (2 years)", "Bank statements (2 months)").
- `loan_conditions`: `outstanding`, `requested`, `received`, `submitted`, `cleared`, `waived`. Titles can be lender wording, so they are **not** used in borrower messages unless linked to a checklist item.

**Upload link.** Two kinds (`document_upload_links`): a per-request link (only its hash is stored, so it can't be put in a later message) and the **borrower portal** link (one per borrower per file, 90 days, the token is kept, so it can be reused). The portal is also where the borrower uploads and fills out the application (`/u/{token}?apply=1`).

**The one queue.** `action_items` (the Action Queue): kind `draft_message` / `task_suggestion`, `payload` (channel, to, subject, body, contactId), `status` pending → approved / edited / dismissed, `source_key` (unique per company, so nothing is drafted twice), `skipped_reason`. Today and each file's Overview show it; drafts with a `contactId` have Send text / Send email through the approval send path. **Missing for this spec:** snooze, priority, a source tag, and a "sent" vs "approved" difference.

**Existing drafters that overlap:**
- Lead intake drafts a first text + email for every new web lead (`lead-intake/firstTouch.ts`).
- Condition reminders: any open file's primary borrower, a borrower condition Outstanding/Requested 3+ days, every 3 days (`src/lib/queue/drafts.ts`), **made when Today opens**, not by a timer.
- Upload-link reminders for overdue request links (same, on Today open).
- Reply drafts for every new borrower message (`ghl-inbound`, Sonnet 5.5 when the key is set).
- Review requests use a pg_cron job (`draft_review_requests()`): the pattern to copy.

**Sending, last contact, opt-outs.** Every send goes through `approve_send()` → the `ghl` function's `send` task, from the file LO's own GHL number/email, with consent, STOP/DND, sending hours, test mode and an idempotency key. Failed sends stay in Inbox → Failed sends. Opt-outs: `contacts.sms_opted_out_at` / `email_opted_out_at`, plus GHL Do Not Disturb checked at send. "Last contact" isn't stored: the assistant works it out as the latest outbound message or call/text/email/meeting note.

**Pipeline card** (`LeadCard`, `card.ts`): lead-type label and color, occupancy, star, name, amount, **"Step X of Y · name"** (`loans.current_step`) with a bar, days in stage, the Ready chip, next open task.

## Plan

### Database
- `loans.next_action` (one of the 7 values, or blank), `next_action_auto` (what the data says), `next_action_manual` (true when Connor picked it), `next_action_at`. A manual pick sticks until the data-derived value changes, then auto takes over again. Changes go into `loan_change_log` (the activity history).
- Function `lead_next_action(loan)` works out the value; triggers on `borrower_applications`, `document_requests`, `preapproval_letters`, prequal-results PDFs, `properties` and stage changes keep it current. Same rules mirrored in `src/lib/leads/nextAction.ts` with tests.
  - Waiting on Application: prequalled/pre-approved stage, no application.
  - Application In Progress: application `in_progress`.
  - Waiting on Documents: any checklist item `requested` or `rejected` for a borrower.
  - Needs LO Review: application submitted (or 1003 by hand) and nothing outstanding.
  - Ready to Shop: a pre-approval letter or prequal results PDF issued, nothing outstanding.
  - Property Found: a home added after the letter (portal "Request numbers" or the Properties tab) with no letter/estimate for it yet.
  - Waiting on Borrower Response: manual only.
- `action_items` gains `source` (`lead_followup`), `priority` (high / normal), `snoozed_until`, `sent_at`.
- `lead_followup_settings` (one row per company; owners/admins): on/off (starts **off**), the intervals from the spec, sending only inside sending hours.
- pg_cron `mpshq-lead-followups` every 30 minutes calls a new `lead-followups` Edge Function (same key pattern as document analysis). It also runs right after a stage / next action / reply / send / document change (by trigger, through the same timer flag), never on page load.

### Rules for a suggestion (all must pass)
Lead stage only; LO assigned; due by the interval since the last contact on this next action; no pending lead_followup draft for the file; no future-dated open task or scheduled send on the file; consent and no opt-out on the channel (text first, else email); not asked for the same documents in the last 3 days; nothing we'd need is missing (no application link → no application nudge). One draft per file at a time, key `lead-followup:<loan>:<next action>:<date>`.

### Wording
- **Waiting on Documents is built in code, not AI**: exactly the open checklist items, plain names ("bank statements", "pay stubs", "W-2s", "ID"), 1 / 2 / top 3 + "a couple other things" + the portal link. Never conditions, codes or lender names.
- Others: Sonnet 5.5, one call per suggestion, with the last few messages, Connor's rules (casual, 1–3 sentences, first name, one ask; no rates, approval, savings, closing dates, scores, income or balances), checked in code; cached on the item until the data changes. No AI key → a code template.
- Needs LO Review: a task for Connor, no message.

### Queue and send
Each item shows name, stage, Next Action, time frame, last contact, why, the draft, channel, priority; Send / Edit & Send / Snooze (date) / Dismiss / View lead. Send = the existing approval send (re-checks everything, LO's own number/email, logs the message, idempotent). A failed send keeps the item with the error for Resend. A reply from the borrower re-checks open suggestions (stale ones are dismissed with a reason).

### Home
Today gets a "Lead follow-ups" box: pending, high priority, overdue; tap opens the list. Each LO sees their own files; Admin sees all (existing file rule).

### Build order
1. Next Action field, rules, card + profile header + override + history.
2. Settings, timer, code-built drafts in the queue (snooze, priority, send).
3. AI wording with fallback; reply re-checks.
4. Today box.

## Decisions (Connor approved the recommendations, 2026-11-16)
1. Web leads get no MPS-HQ first-touch drafts and no "new lead, no contact" suggestion; Connor's GHL workflow sends the first text and prequal email. Leads added by hand still get the nudge.
2. On New lead, Prequal and Pre-approved cards the Next Action tag replaces "Step X of Y"; steps stay from Under contract on.
3. Application and upload links use the borrower portal link (the job may make one; making it sends nothing).
4. Condition reminder drafts stop for lead stages; this feature handles leads.
5. Document nudges are built in code from the checklist; the rest by AI (one call each) with a template fallback.
6. "Already scheduled" = an open task due later or a scheduled send (GHL calendar appointments aren't seen).

Step 2 is built (`20270201000000_lead_next_action.sql`, 2026-11-16).
