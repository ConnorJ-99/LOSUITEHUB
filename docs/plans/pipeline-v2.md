# Pipeline v2: pipelines by loan type (plan, not built)

Connor's request (2026-10-27), from his old app's Leads screens: separate
pipelines by loan type, priority leads, status detail and timeline on cards,
open tasks under each card, and dollar totals per column.

## 1. What Connor gets

**Leads home (`/pipeline`)**
- **Priority Leads** at the top: every starred file, with phone and a tag for its pipeline, one click to open it.
- **Pipeline tiles** with live counts: New Leads, Purchase, Refinance, Investment, HELOC / HELOAN, In Process, Nurture, Lost. Each opens its own board.

**Each pipeline board (`/pipeline/<name>`)**
- Columns for that loan type only, each with a **count and a dollar total**.
- **Cards** (mockup: the old app's Purchase board):
  - star (priority), name, days since last touch;
  - loan type and amount; stage dot;
  - **status detail** dropdown (where they are inside the stage);
  - **timeline** dropdown (ASAP, 1 month, 2 months, 3 months, 3–6 months, 6+ months, just looking);
  - quick buttons: call, text, email, more (move, mark lost/nurture, delete);
  - **open tasks under the card**: the next two by due date with a checkbox, overdue in red, "+N more".
- **"+ Add lead"** at the bottom of each column (starts the lead in that pipeline and column).
- Drag and drop between columns stays, plus the list view and search.
- On a phone the columns scroll sideways one at a time (pipeline must work on a phone).

## 2. The pipelines and their columns

One stage list stays the single source of truth (`loans.stage`); each pipeline is a **view**: which purposes it shows and which stages are its columns.

| Pipeline | Shows | Columns |
|---|---|---|
| New Leads | every purpose, stage Lead | one list (sort into a pipeline by moving to Contacted, or change the purpose) |
| Purchase | purchase | Contacted · Pre-Qualified · Pre-Approved* · Home Search (new) · Under Contract |
| Refinance | rate/term and cash-out refi | Contacted · Pre-Qualified · Application* |
| Investment | investment / DSCR | Contacted · Pre-Qualified · Home Search (purchases only) · Under Contract |
| HELOC / HELOAN | HELOC, HELOAN | Contacted · Pre-Qualified · Application* |
| In Process | every purpose | Submitted / Processing · Approved / CTC · Closed (last 30 days) |
| Nurture | stage Nurture for 7+ days | one list, newest first |
| Lost | stage Lost for 7+ days | one list, with the reason |

\* See open questions 1 and 2.

**Nurture and Lost:** for their first 7 days, files stay visible at the end of their own pipeline (a "Nurture / Lost this week" column) so a mistake is easy to undo; after 7 days they live only in the Nurture or Lost pipeline. Worked out from `stage_changed_at`; nothing to run nightly.

## 3. Data changes (one database script)

- `pipeline_stage` gains **`home_search`** (between Pre-Approved and Under Contract). `stage_rank()` and the milestone → stage mapping are updated so the "never move backward" rule still holds.
- `loans.priority` (boolean, default false): the star. A loan fact, so a repeat client's old loan doesn't stay starred.
- `loans.status_detail` (text): where they are inside the stage. Choices are per stage, in code (`src/lib/pipeline/statusDetail.ts`), e.g.:
  - Contacted: Reviewing credit · Waiting on documents · Application sent · Left voicemail · Needs follow-up
  - Pre-Qualified: Prequal letter sent · Waiting on documents · Preapproved*
  - Home Search: Just started looking · Touring homes · Making offers
  - Under Contract: Option period · Appraisal ordered · …
  - Changing stage clears it (it describes the old stage). Each pick is logged in stage history.
- `loans.timeline` (exists, free text from call notes and web leads) gets the dropdown values. Old free text still shows ("Other: after the lease ends"); nothing is lost. One place, as before.
- No new tables. Tasks, phone, email and amounts already exist.

## 4. Pure, tested logic (`src/lib/pipeline/`)

- `pipelines.ts`: each pipeline's purposes and columns; which pipeline a file belongs in (including the 7-day Nurture/Lost rule); column totals.
- `statusDetail.ts`: choices per stage; whether a detail is valid for a stage.
- `timeline.ts`: dropdown values; reading old free text.
- Card amount: loan amount, else purchase price, else value (open question 3); the column total adds the same figure.
- Tests: every purpose lands in exactly one pipeline; a file 6 days in Nurture still shows in Purchase, at 7 days in Nurture; totals; status detail cleared on stage change; Home Search ranks between Pre-Approved and Under Contract.

## 5. Build order (each step: tests, click-through, commit)

1. Database script + `pipelines.ts` / `statusDetail.ts` / `timeline.ts` with tests.
2. Leads home: Priority Leads + pipeline tiles with counts.
3. Pipeline boards: columns per pipeline, totals, new card (star, status detail, timeline, quick buttons).
4. Tasks under cards (complete from the card), "+ Add lead" per column.
5. In Process, Nurture and Lost pipelines; Today and the loan page link to the right pipeline.

Later (not in this plan): bulk import from a spreadsheet; texting and email through GoHighLevel (the text/email buttons open the phone's messages and mail apps for now).

## 6. Open questions for Connor

1. **Pre-Approved in Purchase:** keep it as its own column (LOSuite today), or fold it into Pre-Qualified as a status detail "Preapproved" like the old app? Recommended: keep the column. Pre-approval letters and the Workflow step already mark it.
2. **Refinance and HELOC columns:** after Pre-Qualified, is "Application" (taken, disclosures out) the right last column before In Process?
3. **Card amount and totals:** loan amount (recommended: what comp follows) or purchase price for purchases (the old app showed $157,298 on a purchase card)?
4. **Status detail choices:** use the old app's list (please list any not visible in the screenshots), or start from the list above and edit later in Settings?
5. **In Process:** one shared board for every loan type after Under Contract (recommended), or keep Processing → Closed columns inside each pipeline?
