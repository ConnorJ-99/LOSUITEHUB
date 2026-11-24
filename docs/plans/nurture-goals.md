# MyHome — Nurture Goals & Financial Planning (plan, 2026-11-24)

Connor's spec "MyHome with MPS — Nurture Goals & Financial Planning System" (pasted 2026-11-24). Built in his four phases, his OK after each. This file is the architecture review the spec asks for before any code (its section 8), and the decisions to make.

## What already exists (reused, not rebuilt)

| Spec needs | Already in MPS-HQ / MyHome | Plan |
|---|---|---|
| Borrower login, account, who sees what | MyHome accounts (`borrower_accounts`), the `myhome` Edge Function (every borrower read/write goes through it, service role, checks the person is on the file), `myhome_events` | All borrower reads and writes go through `myhome` as now. No new login. |
| Nurture stage, obstacles, plan | `loans.nurture_*`, `readiness_plans` / `readiness_actions` / `readiness_milestones` (approved plan, milestones with target dates, done by a person), nurture check-in drafts | Goals sit next to the plan. A milestone can point to a goal (optional) and is ticked when the goal is verified. |
| "Review mechanism" for borrower updates | `nurture_updates`: unverified → Verify / Dismiss by a person, shown in the nurture view's **Updates from {name}** card, `nurture_reply` notice | Borrower goal updates become `nurture_updates` rows (`source = 'myhome'`, linked to the goal), so they land in the same card with Verify. |
| Verified assets | 1003 `assets` on the loan (LO-entered, last 4 only) | Stay the verified figures. Borrower-reported assets are a separate, person-level record (Phase 2). |
| Debts | 1003 `liabilities` (balance, payment) | A debt goal can be tied to a 1003 debt (picked by the LO) or typed. Borrower updates never change the 1003 row. |
| Verified credit score | `loan_borrowers.estimated_credit_score` (the LO's figure) | Decision below. Borrower-reported scores live only in the goal's history. |
| Activity history | notes on the file, `loan_change_log` | Each borrower update leaves a short note ("Borrower updated savings from $2,400 to $3,100 (MyHome)") and a `myhome_events` row. |
| Math | `src/lib/calc/` (pure, tested) | `calc/goals.ts` (progress, remaining, per-period savings, time to goal) and `calc/cashflow.ts` (recurrences, forecast, actuals replacing projections). Money in cents, dates as YYYY-MM-DD. |

Changes from the earlier MyHome plan (docs/plans/myhome.md, Stage 3 "Update my numbers"): borrowers no longer edit the 1003 rows directly. Their numbers stay borrower-reported, apart from the LO's verified figures, as this spec requires.

## MyHome tab on every file (Connor, 2026-11-24, built)
A **MyHome** tab in every file's side menu (open, nurture and closed; `?tab=myhome`, `MyHomeTab`), taken off the Overview: the account line (status, Send code to GHL, Copy link, Draft text/email, New code, Turn off), "Asked from MyHome" with Save value & mark done, and the extra payments they reported. Goals (Phase 1), assets (Phase 2) and the budget (Phase 3) are built into this tab.

## Phase 1 — Nurture goals (savings, credit, debt) — built 2026-11-24 (`20270303000000_nurture_goals.sql`, `myhome` redeploy)

Tables (RLS: people who can see the file read; the LO side writes through the app; the borrower side only through `myhome`):
- `nurture_goals`: file, person, kind (`savings` / `credit` / `debt`), label, debt type (credit card, auto, installment, student, other) and optional `liability_id`, start value, target value, current reported value and when, LO-verified value and when, optional target date, status (not started, in progress, borrower reported complete, LO verified complete, paused), sort order, created/updated by.
- `nurture_goal_updates`: every change, never overwritten: goal, value (balance, score, contribution or payment), kind, note, date, who (borrower account or staff), and the `nurture_updates` row it raised.

MPS-HQ (nurture view): a **Goals** card (add savings / credit / debt goal, edit target, pause, remove, Verify complete), each goal's history, and the verified value beside the reported one.
MyHome (Nurture loan): **My goals**: one card per goal with a progress bar, "You're $1,200 away", Update button (a few taps), history, and "I reached this goal". A completion check shows only after the LO verifies. A note under credit: self-reported scores are for tracking; qualifying needs a mortgage credit report.
Rules: savings progress = the latest reported balance (not the sum of contributions); debt progress = (start − current) ÷ (start − target); credit = (current − start) ÷ (target − start); completion never changes the stage or pre-approval.

## Phase 2 — My assets (every borrower, every stage)

`borrower_assets` (person-level, so it survives Nurture → Closed and the next loan) + `borrower_asset_balances` (history). Nickname/institution, category (checking, savings, cash, investment, retirement, other), reported balance, date, notes; no account numbers, no logins. MyHome shows **My assets** with the combined reported total (prominent on the nurture dashboard only when a savings goal exists). MPS-HQ shows three columns: borrower-reported, verified (1003 assets), eligible for qualifying (what the Max Approval math counts). A savings goal can follow the accounts the borrower ticks.

## Phase 3 — Income, expenses & savings planner (optional for the borrower)

`budget_items` (income or expense, name, amount, schedule: weekly / biweekly / semimonthly / monthly / annual / every N days / one-time / irregular, next date, category, notes, paused), `budget_entries` (actual paid/received, replacing the projected one for that date so nothing counts twice), a starting cash balance and desired monthly savings. MyHome: 7 / 30 / 90-day rolling forecast and monthly summary, projected vs confirmed, savings plan tied to the savings goal ("about 6 months at $650 a month"). Projected savings never count as saved.

## Phase 4 — Integration & testing

Notices (goal reported complete, credit score updates, big balance changes), Today/activity, permissions review, mobile pass, PGlite tests for every script, calc tests, a signed-in MyHome check on a TEST borrower.

## Decisions for Connor

Connor, 2026-11-24:
1. **Goals beside the plan.** The readiness plan stays the written roadmap; a milestone can point to a goal and ticks itself when the LO verifies that goal.
2. **Updates card + notice on big ones.** Every borrower goal update is a `nurture_updates` row in "Updates from {name}" (Verify) plus a note on the file; a `myhome_request` notice only for "I reached this goal", credit score updates and balance changes of 10% or more.
3. **The file's credit score is the verified one.** `loan_borrowers.estimated_credit_score`; verifying a credit goal can update it.
4. **The LO sees the whole budget** (Phase 3): MPS-HQ can open the borrower's full income and expense list and forecast.
