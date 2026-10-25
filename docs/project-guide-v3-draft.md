# LOSuite v3 project guide (draft)

Pasted by Connor on 2026-10-25. **Status: draft, kept alongside CLAUDE.md** (Connor chose "keep both for now"). CLAUDE.md is still the guide we work from. Where this draft disagrees with what's built, these choices apply:

- **The Prequal tab stays as its own tab** (Connor's choice), in addition to the tabs listed below.
- **Next phase: Assistant core + Today view** (this draft's Phase 2).
- Already built in v2 and not to be rebuilt: pipeline and stage history, purpose-aware profile (Overview, Notes, Properties, tasks), 1003 + MISMO 3.4 import/export, manual income calculators with push-to-1003, phone prequal with upgrades.

---

The core idea: the assistant does the work, Connor approves it
Each borrower file has an Action Queue: the one place where everything the assistant prepares shows up for review. Examples:

* "Draft email to the listing agent introducing yourself" with Approve, Edit or Dismiss
* "Option period ends Nov 3: task created" with Accept or Change
* "Call notes suggest DTI is about 44%: update the pre-qual?" with Apply or Ignore

The home screen is the Today view: every file's queue items, tasks and deadlines in one list, sorted by due date. Connor should be able to run his day from Today without opening tabs.

## Stack

* React + TypeScript + Vite, Tailwind, shadcn/ui
* Supabase (Postgres, Auth, Storage, Edge Functions)
* AI: Claude API, called only from Supabase Edge Functions (the API key never reaches the browser), using structured JSON outputs validated against a schema
* PDF: HTML templates rendered to PDF (propose the library before choosing)
* Deploy: Vercel (later)

## Hard rules

1. Never connect to the production Supabase project. Use the dev project in `.env.local`. Data migration from the old app happens at the end, through a reviewed script.
2. Every relationship has a real foreign key with an explicit `on delete` rule. No orphaned records.
3. One person, one record. A lead becomes a client by changing stage, not by being copied. Repeat and refi clients link to their prior loans.
4. One source of truth per value. Purchase price, loan amount, rate, closing date, insurance date and so on live in one place. Every screen reads and writes that place.
5. All mortgage math lives in pure, unit-tested functions (`src/lib/calc/`). No math inside components, and no math done by AI. AI extracts the numbers; code calculates.
6. AI never sends, saves or changes anything on its own. Everything AI produces lands in the Action Queue or a review screen first. Nothing reaches a borrower, agent or title company without Connor clicking Approve.
7. Every AI extraction shows its source: the page and quoted text from the document or call notes it came from, plus a confidence level. Low-confidence fields are highlighted for review.
8. Every AI run is logged (`ai_runs` table: file, task type, input reference, output, model, approved/edited/dismissed). This is for auditing and improving prompts.
9. Row Level Security on every table from day one, scoped by organization and user, so it's ready for future loan officers.
10. Work in small phases. At the end of each phase: run tests, run the app, summarize what to click through, then commit.
11. Before adding a new library, table or major pattern, explain why in one or two sentences and wait for approval.

## Pipeline stages

Lead → Contacted → Pre-Qualified → Pre-Approved → Under Contract → Processing → Clear to Close → Closed. Side stages: Nurture (not ready yet) and Lost (with a reason). Every stage change is logged with a timestamp. Moving a stage can trigger a checklist of standard tasks (defined in settings, not hard-coded).

## Loan purposes

Purchase, Refinance (rate/term and cash-out), HELOC/HELOAN (2nd liens; CLTV is the qualifying ratio and 1st lien balance is required), and Investment/DSCR. The borrower profile shows or hides sections by purpose. Flag Texas §50(a)(6) homestead cash-out rules (80% CLTV cap, 12-day notice, 1-year seasoning) wherever they apply.

## What the assistant does, from lead to close

### 1. Lead intake

* Web forms on mps.mortgage post to a Supabase Edge Function that creates a lead with the basics (name, contact info, purpose, price/value range, credit estimate, timeline, source).
* Duplicate check by phone or email. A returning person attaches to their existing record.
* The assistant drafts a first-touch text and email into the Action Queue.

### 2. Call notes → pre-qualification

* Connor types or pastes notes from the phone call in plain language (e.g. "Marcus, landscaping biz 6 yrs, ~$9,800/mo, house worth 467, owes 282, wants 75K cash out, 652 credit, one late on truck 2024").
* The assistant extracts structured fields (income, debts, value, balances, credit, goals, timeline, flags such as self-employed or first-time buyer) and proposes updates to the Overview and 1003. Connor accepts field by field.
* Code (not AI) then runs the pre-qual: LTV/CLTV, estimated payment, DTI, and a readiness result: Ready to pre-approve, Needs documents, Needs Manual Review (likely Non-QM), or Not ready yet → Nurture with a reason (credit, down payment, DTI, must sell first).
* The assistant suggests the next step and drafts the follow-up message and document request.

### 3. Document requests

* A document checklist is generated from the loan purpose and borrower flags (W-2 vs self-employed vs bank statement vs DSCR, gift, divorce, etc.). The rules live in a settings table, not in AI.
* The assistant drafts the request email or text listing exactly what's needed. Each item tracks Requested → Received → Reviewed.
* Uploaded documents are stored on the file and auto-classified (paystub, W-2, tax return, bank statement, contract, ID). Connor can correct the classification.

### 4. AI income calculators

* Upload paystubs, W-2s, tax returns (1040 with Schedule C/E, 1120S, 1065/K-1) or bank statements.
* AI extracts the numbers with source quotes. Code runs the standard calculation (2-year averaging, add-backs such as depreciation, expense factors for bank statements, 75% of lease for rental) and shows the worksheet line by line.
* Connor reviews and pushes the result to the 1003 income section with one click. Manual entry works for every calculator too.

### 5. Pre-approval letters

* Letter templates are stored in settings with merge fields (borrower names, max price or specific address, loan type/program, down payment, expiration, LO name and NMLS, company NMLS, required disclaimers).
* Generating a letter fills the template from the file, shows a live preview, lets Connor edit any field for this letter, then exports a PDF. Every generated PDF is saved to the file with its version and date.
* One click makes a new version for a specific property/offer price.

### 5b. Payment estimates (from the Properties tab)

* Select one or several homes on the Properties tab and build a side-by-side estimate. Each column is one option: a home plus a rate, down payment (% or $), program, term, seller credit and closing-cost assumption. Comparisons can be one home at different rates or down payments, or several homes on the same terms. Up to 4 options.
* Each option shows the loan amount, LTV, P&I, taxes (from the home's tax rate), insurance, HOA, MI, total monthly payment, cash to close, and DTI using the borrower's income and debts from the 1003. Flag any option that goes over the pre-approval amount or a max-DTI setting.
* Defaults come from the file (income, debts, current scenario rate) and from settings (default closing-cost %, prepaids, MI factors by program and LTV). Every value can be overridden per option.
* All math runs in `src/lib/calc/` with tests. AI doesn't calculate. The assistant can draft the email or text that sends the comparison with a short plain-English summary ("Option B saves $212/mo but needs $14K more at closing").
* Preview it, then export a borrower-facing PDF that's saved to the file. Mark one option as recommended. Saved estimates can be reopened and duplicated.
* Every estimate carries the disclaimer: "This is an estimate only and not a loan commitment or official Loan Estimate…" (wording in `docs/PORTING.md`). Official Loan Estimates still come from Arive.

### 6. Contract intake (transaction coordinator)

* Upload the executed purchase contract (TREC 1-4 Family Resale and the common addenda first).
* The assistant extracts:
  * Contacts: buyer(s), seller(s), listing and buyer's agents and brokerages, title company and escrow officer, plus the lender (MPS). Each one is matched to an existing partner record or proposed as a new one.
  * Key dates: effective date, option period end, financing contingency/Third Party Financing deadline, survey, appraisal, closing date, possession.
  * Key terms: sales price, earnest money, option fee, seller concessions, title policy payer, HOA, financing type and amount.
* After Connor reviews the extraction, the assistant:
  * writes the dates to the loan (single source of truth) and creates tasks with due dates for each one,
  * creates per-contact tasks (e.g. "Send intro + timeline to listing agent", "Order title from escrow officer", "Confirm EM receipt"),
  * drafts the emails for each contact into the Action Queue,
  * flags mismatches against the file (contract price ≠ pre-approval amount, financing amount ≠ loan amount, closing date tighter than standard turn times).
* A Contract section in Loan Details shows the extracted terms with source quotes.

### 7. Drafting emails and texts

* Any file can ask the assistant for a draft: "update the realtor that we're clear to close", "ask Marcus for his 2024 return", "explain why we need a letter of explanation".
* Drafts use the file's real data and the right recipient, are written in Connor's voice, and keep texts short.
* Saved message templates live in settings. AI personalizes them; it doesn't replace them.
* Sending is a later phase (through the GoHighLevel API). Until then, drafts can be copied, and every sent message is logged on the file.
* Every message stays compliant: no rate promises, no guarantee language, and NMLS info in email signatures.

### 8. Processing to close

* Conditions list (from the lender's approval) with status and owner. Each condition can link to documents and to a drafted request.
* Milestone updates to the borrower and agents (appraisal ordered/received, approved, CTC, closing scheduled) as one-click drafts.

### 9. After closing

* Closed-loan record: lender, rate, term, payment, closing date, insurance renewal date, escrow analysis date.
* Tracking: anniversary and annual review reminders, insurance renewal, refi opportunity flag when market rate drops a set amount below their rate, and HELOC/cash-out opportunity as equity grows.
* Partner tracking: which agents and partners sent which loans.

## Loan Info and Product Search

* Loan scenario fields: program, rate, term, amortization, comp type, lock period, selected lender and saved quotes.
* Product Search: deterministic, rule-based search of Connor's lender catalog. Results show eligible programs first, then excluded programs with the exact failed rule. Data model: `lenders` → `programs` (program-wide rules) → `program_matrix_rows` (occupancy, purpose, doc type, FICO min, loan amount min/max, max LTV, max CLTV, max DTI).
* No live pricing. Connor records quotes from lender portals or Arive against a program.

## Explicitly out of scope

Do not build these unless Connor asks for them by name: a call list or dialer, rate pricing or official Loan Estimate/disclosure tools (Arive has them; borrower payment estimates in 5b are in scope), a general document drive (Google Drive covers it), marketing/social tools, ad dashboards, flyer generators, debt payoff simulators, property tax calculators, a visual automation builder, or any standalone "tools" page. The borrower app (MyHome) stays a separate project and integrates later.

## Design

* Visual reference screenshots are in `docs/design-reference/`. Match their layout, density and feel. Do not copy logos, product names or another company's brand. Use MPS Mortgage branding.
* App shell: collapsible left sidebar with only Today, Pipeline, Borrowers, Partners, Lenders, Settings. Primary action "New Lead" at the top; user and role at the bottom.
* Borrower profile tabs: Overview (with the Action Queue), 1003, Income, Documents, Notes, Loan (scenario, Product Search, contract, conditions). Purchase files add Properties and Letters. No other tabs. (Connor's override: the Prequal tab stays.)
* AI output always has a clear visual treatment: an "Assistant" label, source quote on hover or expand, and Approve, Edit and Dismiss buttons.
* Forms: responsive grid of up to 6 columns, compact inputs, required fields marked `*`, calculated fields read-only and greyed out. Boolean flags are toggle chips.
* Build shared components first (Input, Select, CurrencyInput, PercentInput, ToggleChip, Card, SummaryBar, DataTable, Tabs, EmptyState, QueueItem, SourceQuote, ReviewField) and use them everywhere.
* Mobile: Today, Pipeline, borrower Overview, Notes (call notes entry) and approving queue items must work well on a phone.

## Build phases

0. Foundation (in progress): repo, Supabase dev project, auth, org/user model with RLS, app shell, shared components, calc library with tests.
1. Pipeline and borrower record: stages, stage history, purpose-aware profile shell, Overview, Notes, Today view, tasks.
2. Assistant core: Edge Function wrapper for Claude with schema-validated outputs, `ai_runs` log, Action Queue, and drafted messages with templates. Prove it end to end with "draft a follow-up text."
3. Contract intake (priority feature): port the old extraction (see `docs/PORTING.md`), then add the review screen, partner matching, dates → tasks, per-contact tasks and drafts, and mismatch flags.
4. Call notes → pre-qual with field-by-field review and the readiness result.
5. Lead intake from mps.mortgage forms with duplicate check and first-touch drafts.
6. 1003 + MISMO 3.4 import/export (test round-trip into Arive).
7. Documents: checklist rules, requests, upload, classification. Then AI income calculators with push-to-1003.
8. Letters and estimates: letter templates, live preview, PDF, versioning; then payment estimates from the Properties tab (one or more homes, different rates and down payments) with PDF and drafted send-off message.
9. Loan Info + Product Search + lender admin. Conditions and milestone updates.
10. After closing: closed-loan tracking and reminders.
