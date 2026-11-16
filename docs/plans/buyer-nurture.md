# Buyer Recovery & Nurture System

Connor's spec, 2026-11-16. Step 1: audit and plan. Nothing is built yet; waiting for his go-ahead and the decisions at the end.

## What exists today (audit)

**Nurture pipeline.** It is one side stage, `loans.stage = 'nurture'`, with no steps (`src/lib/pipeline/pipelines.ts`).
- Files get there from the file header's **Change status** menu (`StageMenu` → `useStageChanger`), with no reason asked. Lost is the only stage that asks for a reason: a database check requires `loans.lost_reason`.
- `/pipeline/nurture` is the older generic board/list page (`PipelinePage`), with search by name and the usual filters. The pipeline overview has a Nurture tile.
- A nurture file opens the normal active-loan profile. Nothing is nurture-specific.

**Header.** The file header has Star, Hold, Quick quote, Edit (the file's details), **Change status** (the stage menu) and "…" (Delete). There is no pipeline picker under Edit: the stage menu is the place.

**Where the finances live** (all read on screen, nothing re-entered):
- **1003:** jobs and other income, assets (accounts last 4 only), liabilities (payment, balance, payoff), homes owned.
- **Credit:** `loan_borrowers.estimated_credit_score` (an estimate; no pulled-credit data is stored) and `credit_events` (bankruptcies, foreclosures, lates with dates).
- **Income worksheets** (Income tab).
- **The 1003 tab's prequal figures:** Max Approval, DTI, cash to close vs funds, Readiness (Not ready / Manual review / Needs documents) with reasons. These are computed, never stored.

**Documents and PDFs.**
- `loan_documents` (kind, template_version, property, `published_at` for the borrower portal), built with @react-pdf/renderer through `useSavePdf`. Every PDF is one page today; contents are worked out in pure tested code in `src/lib/documents/`.
- Each save is a new row. Pre-approval letters have their own versioning (`preapproval_letters`).
- **Send…** emails a saved PDF through GoHighLevel with every check (`SendSavedPdf`).

**Simulators.** None to reuse for debt payoff or savings. There are amortization, DTI and Max Approval math helpers.

**Action queue.** `action_items` with `source`, `priority`, `snoozed_until` and `sent_at` (from lead follow-ups). The queue entry already has Send / Edit / Schedule / Snooze / View lead / Dismiss.
- The lead follow-up timer only looks at lead stages, so moving a file to Nurture already stops `lead_followup` drafts, and its waiting draft is dismissed ("no longer a lead").
- Condition reminders skip Nurture.
- Reply drafts (`ghl-inbound`) are made for every matched client, nurture included.

**GoHighLevel.**
- Send goes through the approval path from the LO's number or email, with consent, STOP/DND, sending hours and test mode.
- Inbound replies are saved by `ghl-inbound`, which makes one reply draft per burst.

**Activity log and alerts.**
- Activity is kept in three places: notes (kinds note / call / text / email / meeting), `loan_stage_history` (stage moves), and `loan_change_log` (chosen fields, with who and why).
- `notifications` are made by triggers, one kind per event, set per user in Settings → Notifications.

**Who sees what.** Row Level Security: a loan officer sees their own files, and the admin login sees all. Partners see nothing yet (there is no realtor portal).

## Plan

### Database (new, nothing duplicated)
- **`loans`** gains:
  - `nurture_stage` (the 10 stages below), `nurture_entered_at`, `nurture_obstacles` (text[] of keys), `nurture_note`, `nurture_target` (time frame) and `nurture_next_follow_up`.
  - `partner_status`: realtor-safe text, "Preparing for Homeownership" while in Nurture. No figures, ever.
  - A trigger keeps `nurture_stage` set only while `stage = 'nurture'`.
  - Every change goes in `loan_change_log`.
- **`readiness_plans`**: a plan per file, with versions. Status draft → approved → superseded. Obstacles, intro, AI run, approved by and when.
- **`readiness_actions`** (per plan): obstacle, what, why, steps, docs to verify, status, order.
- **`readiness_milestones`** (per plan, optionally per action): title, how it's measured, target date, follow-up date, status (outstanding / reported / done).
  - Only a person marks a milestone done or verified. The database refuses the service role, so no AI or timer can.
- **`nurture_updates`**: what the borrower reported (from a reply or typed by the LO). Fields: the milestone, a summary, Unverified / Verified (only a person verifies), the suggested next step, and the message it came from.
- `action_items.source = 'nurture_milestone'`, key `nurture:<milestone>:<kind>`.
- Document kind `readiness_roadmap`.
- Notification kind `nurture_reply`.
- pg_cron `mpshq-nurture-drafts`.

### Steps 2–3 (first build)
- **"Move to Nurture"** button in the header. The header's Change status → Nurture runs the same modal:
  - pick at least one obstacle (Step 4 list, with Custom), target time frame, optional note.
  - It saves the stage and nurture fields in one database function and logs a note.
  - Nothing is copied.
- **Nurture stages** on the Nurture page as columns: Initial Review → Plan Needed → Plan Generated → Plan Delivered → Working on Plan → Waiting for Milestone → Ready for Reassessment → Ready for Prequal → Paused / Unresponsive.
  - Files already in Nurture start at Initial Review.
  - Filters: obstacle, stage, LO, realtor, overdue milestones, search.
- **Nurture view** of the profile (same design, different layout), shown while `stage = 'nurture'`:
  - Overview
  - Financial Readiness (pulled from the 1003, credit and prequal math; "estimate" labels where it's an estimate)
  - Readiness Plan
  - Communication: messages, notes and reported updates
  - Hidden while in Nurture: Scenarios & Estimate, Contract, Letters, Docs & Conditions' conditions, lender and pricing chips, closing items.
  - Documents and the 1003 stay reachable.

### Steps 4–5
- **Generate Buyer Readiness Plan.** The LO picks or edits obstacles.
  - Opus 5.5 drafts from the obstacles and the file's real figures, as structured actions and milestones. Its rules: no promised scores, approval or dates; plain English; personal.
  - Every field is editable, then **Approve**. No AI = a starter plan built in code from the obstacle list for the LO to fill in.
  - Stage: Plan Generated on save, Plan Delivered when the roadmap is sent.
- **PDF "Your Roadmap to Homeownership"** (3–5 pages, a first for MPS HQ), built only from the approved plan.
  - Shows the disclosure and NMLS lines.
  - Preview, save to Documents (each version kept; regenerate when the plan changes), download, and Send… through the GoHighLevel email draft (PDF attached, no figures in the email).

### Steps 6–8
- **Milestone drafts** (timer, `nurture_milestone`): roadmap delivery, a few days before, on the day, overdue, and a reassessment request when major milestones are done.
  - Casual texts like lead follow-ups (AI-worded with the same rules, template fallback).
  - At most one waiting per borrower. None after a recent nurture draft, on opt-out/DND, or when Paused / closed / active.
- **Replies:**
  - `ghl-inbound` saves them as today.
  - For a nurture borrower, one AI call tags the milestone, records the reported progress as an **Unverified** update with a suggested next step, and notifies the LO.
  - Only the LO verifies or completes.
- **Reassess for Prequalification** (header button while in Nurture): a review of updated figures and milestones. On confirm, the file moves back to **New lead (contacted)**, never straight to Pre-Qualified.
  - The plan becomes read-only, nurture drafts stop, and lead follow-ups take over.

### Step 9
**Nurture dashboard** `/nurture`:
- active count, by obstacle;
- plans generated / delivered;
- outstanding and overdue milestones;
- response rate (replies within 7 days of a nurture message);
- reassessment requests;
- nurture → active and nurture → funded;
- average time in nurture;
- a "needs attention / getting close" list.

LO sees their own; admin sees all.

## Decisions for Connor
1. "Closed / No Longer Interested": move the file to **Lost** with a reason (one home for dead files, compliance check already there), or keep it as a Nurture stage with its own required reason? Recommended: Lost.
2. Coming back from Nurture: the file returns to **New lead (contacted)** so lead follow-ups take over; never straight to Pre-Qualified. OK?
3. Plan AI: **Opus 5.5** (better at a structured, personal plan; costs more per plan) or Sonnet 5.5? Recommended: Opus 5.5.
4. Roadmap email: attach the PDF (existing GoHighLevel document send), and also publish it to the borrower portal? Recommended: attach; portal optional per file.
5. Drag or Change status → Nurture without obstacles (e.g., from a board): always open the modal (required), as spec'd. Bulk/imported files land in Initial Review with none.
