# LOSuite v3 project guide (draft)

Updated by Connor on 2026-10-25 (adds the Loan file UI, Phase 1b, and 5c Borrower documents and e-sign). **Status: draft, kept alongside CLAUDE.md.** Where it disagrees with what's built: the Prequal tab stays (Connor's choice), and already-built work (pipeline, profile, 1003 + MISMO, income calculators, phone prequal, Action Queue and Today) is not rebuilt. The document templates folder it mentions (docs/document-templates/) is not in the repo yet.

---

## What this is
LOSuite is the **loan officer assistant** for **MPS Mortgage LLC** (NMLS #2501110), a mortgage brokerage in Dallas-Fort Worth, Texas. It takes a borrower from **lead → pre-qualified → pre-approved → under contract → closed**, then keeps tracking them after closing.

It is **not** a toolbox. Every feature must help move a file to the next stage or keep a closed client. If a feature doesn't do that, it doesn't go in. The old version (built in Lovable) failed by adding too many tools. When in doubt, leave it out and ask.

The owner (Connor) is a licensed loan officer, **not a software engineer**. Explain decisions in plain English, keep changes small, and never assume he can debug code by hand.

Arive stays the production LOS (pricing, disclosures, submission, underwriting). LOSuite does not replace Arive.

## The core idea: the assistant does the work, Connor approves it
Each borrower file has an **Action Queue**: the one place where everything the assistant prepares shows up for review. Examples:
- "Draft email to the listing agent introducing yourself" with Approve, Edit or Dismiss
- "Option period ends Nov 3: task created" with Accept or Change
- "Call notes suggest DTI is about 44%: update the pre-qual?" with Apply or Ignore

The home screen is the **Today** view: every file's queue items, tasks and deadlines in one list, sorted by due date. Connor should be able to run his day from Today without opening tabs.

## Stack
- React + TypeScript + Vite, Tailwind, shadcn/ui
- Supabase (Postgres, Auth, Storage, Edge Functions)
- AI: Claude API, called **only from Supabase Edge Functions** (the API key never reaches the browser), using structured JSON outputs validated against a schema
- PDF: HTML templates rendered to PDF (propose the library before choosing)
- Deploy: Vercel (later)

## Hard rules
1. **Never connect to the production Supabase project.** Use the dev project in `.env.local`. Data migration from the old app happens at the end, through a reviewed script.
2. **Every relationship has a real foreign key** with an explicit `on delete` rule. No orphaned records.
3. **One person, one record.** A lead becomes a client by changing stage, not by being copied. Repeat and refi clients link to their prior loans.
4. **One source of truth per value.** Purchase price, loan amount, rate, closing date, insurance date and so on live in one place. Every screen reads and writes that place.
5. **All mortgage math lives in pure, unit-tested functions** (`src/lib/calc/`). No math inside components, and no math done by AI. AI extracts the numbers; code calculates.
6. **AI never sends, saves or changes anything on its own.** Everything AI produces lands in the Action Queue or a review screen first. Nothing reaches a borrower, agent or title company without Connor clicking Approve.
7. **Every AI extraction shows its source**: the page and quoted text from the document or call notes it came from, plus a confidence level. Low-confidence fields are highlighted for review.
8. **Every AI run is logged** (`ai_runs` table: file, task type, input reference, output, model, approved/edited/dismissed). This is for auditing and improving prompts.
9. **Row Level Security on every table** from day one, scoped by organization and user, so it's ready for future loan officers.
10. Work in small phases. At the end of each phase: run tests, run the app, summarize what to click through, then commit.
11. Before adding a new library, table or major pattern, explain why in one or two sentences and wait for approval.

## Pipeline stages
Lead → Contacted → Pre-Qualified → Pre-Approved → Under Contract → Processing → Clear to Close → Closed.
Side stages: **Nurture** (not ready yet) and **Lost** (with a reason). Every stage change is logged with a timestamp. Moving a stage can trigger a checklist of standard tasks (defined in settings, not hard-coded).

## Loan file workspace (header, workflow, fees, 1003 status)
Reference screenshots are in `docs/design-reference/loan-file/`. They come from a lender's broker portal, so use the layout ideas and none of its branding.

### Loan header (on every borrower tab)
- Key metrics strip: loan amount, loan type/program, credit score with tier (e.g. "681 Fair"), LTV, CLTV, HCLTV (for HELOCs), DTI and property address (or "TBD, city"). All values are read from the single source of truth and calculated by `src/lib/calc/`.
- **Milestone stepper:** Application → Disclosures Sent → Submitted → In Underwriting → Approved w/ Conditions → Conditions Submitted → Clear to Close → Docs Out → Closed → Funded. Each milestone stores its date when reached. These are processing milestones inside the Under Contract → Closed pipeline stages; keep them in sync with pipeline stages through one mapping, not two separate statuses.
- **Assigned team:** loan officer, processor (optional), lender, account executive, plus the agents and title contacts from the contract. Built for future hires, but works solo.
- Next-step badge: "Send disclosures · Loan Officer · 3d at this step".

### Workflow (top of the Overview tab, above the Action Queue)
- **Next-step card:** the single most important thing to do now, with one primary button, plus "also ready for you" items (e.g. Complete 1003, Request documents, Order appraisal).
- **Grouped step checklist** with a progress bar per group: **Origination**, **Disclosure & Setup**, **Underwriting**, **Closing & Funding**. Each step has a status (Not started, Ready, In progress, Done, Blocked, N/A), an owner (Loan Officer, Processor, Borrower, Lender, Title) and days at the current step.
- **Blocked steps say why** in plain language, e.g. "Can't submit: no lender/program selected" or "1003 is missing 2 required fields". Readiness and blocking rules are pure functions in code over the file's data. Step templates per loan purpose live in a settings table.
- Steps done outside LOSuite (send disclosures, price and register, order appraisal, submit, CD) are **tracked here, not performed here**: a step can be marked done with a date, open the right Arive or lender page, or create a drafted message (e.g. "Order title" email to the escrow officer). LOSuite never issues disclosures or registers loans.
- Completing a step can create the next tasks and drafts in the Action Queue. Contract dates (Section 6) and conditions (Section 8) feed into this checklist.

### Fee sheet (Fees tab)
- A cash-to-close **worksheet** laid out in Loan Estimate sections: A Origination, B Services you cannot shop for, C Services you can shop for, D Total loan costs, E Taxes and government fees, F Prepaids, G Initial escrow at closing, H Other, I Total other costs, J Total closing costs. Then seller credits, lender credits, earnest money, down payment and **estimated cash to close**.
- Each fee has: name, amount, paid to, paid by (Borrower, Seller, Lender, Other), APR-affecting, financed, and before/at closing.
- **Smart defaults:** fee templates in settings by loan purpose, program and county (title, recording, appraisal, etc.). Calculated lines are code: per-diem interest from the closing date, hazard and tax reserves from the housing expense, upfront MI/FF (FHA UFMIP, VA funding fee) by program. Any line can be overridden.
- **Lender-paid compensation** section showing BPC vs LPC and the comp amount.
- **Housing expenses** live on this tab and are the same values used everywhere: taxes, insurance, HOA, MI, flood, plus P&I and the total payment.
- The fee sheet feeds payment estimates (5b) and the Overview cash-to-close figure. It can be exported as a "Fee Worksheet" PDF labeled as an estimate.
- It is an internal worksheet. **Official Loan Estimates and Closing Disclosures still come from Arive.**

### 1003 completeness
- The 1003 tab lists the URLA sections (Loan Information, Subject Property, Borrower Info, Credit Scores, Employment & Income, Assets, Liabilities, Real Estate Owned, Declarations, Demographic Information, Origination Party), each with a status: complete, number of missing required fields, or not started.
- **Validate Application** lists every missing or inconsistent required field and jumps to it. MISMO export warns on validation errors before export.
- A red count on the 1003 tab shows the number of missing required fields.

## Loan purposes
Purchase, Refinance (rate/term and cash-out), HELOC/HELOAN (2nd liens; **CLTV is the qualifying ratio** and 1st lien balance is required), and Investment/DSCR. The borrower profile shows or hides sections by purpose. Flag Texas **§50(a)(6)** homestead cash-out rules (80% CLTV cap, 12-day notice, 1-year seasoning) wherever they apply.

## What the assistant does, from lead to close

### 1. Lead intake
- Web forms on mps.mortgage post to a Supabase Edge Function that creates a lead with the basics (name, contact info, purpose, price/value range, credit estimate, timeline, source).
- Duplicate check by phone or email. A returning person attaches to their existing record.
- The assistant drafts a first-touch text and email into the Action Queue.

### 2. Call notes → pre-qualification
- Connor types or pastes notes from the phone call in plain language (e.g. "Marcus, landscaping biz 6 yrs, ~$9,800/mo, house worth 467, owes 282, wants 75K cash out, 652 credit, one late on truck 2024").
- The assistant extracts structured fields (income, debts, value, balances, credit, goals, timeline, flags such as self-employed or first-time buyer) and proposes updates to the Overview and 1003. Connor accepts field by field.
- Code (not AI) then runs the pre-qual: LTV/CLTV, estimated payment, DTI, and a **readiness result**: Ready to pre-approve, Needs documents, Needs Manual Review (likely Non-QM), or Not ready yet → Nurture with a reason (credit, down payment, DTI, must sell first).
- The assistant suggests the next step and drafts the follow-up message and document request.

### 3. Document requests
- A document checklist is generated from the loan purpose and borrower flags (W-2 vs self-employed vs bank statement vs DSCR, gift, divorce, etc.). The rules live in a settings table, not in AI.
- The assistant drafts the request email or text listing exactly what's needed. Each item tracks Requested → Received → Reviewed.
- Uploaded documents are stored on the file and auto-classified (paystub, W-2, tax return, bank statement, contract, ID). Connor can correct the classification.

### 4. AI income calculators
- Upload paystubs, W-2s, tax returns (1040 with Schedule C/E, 1120S, 1065/K-1) or bank statements.
- AI extracts the numbers with source quotes. **Code** runs the standard calculation (2-year averaging, add-backs such as depreciation, expense factors for bank statements, 75% of lease for rental) and shows the worksheet line by line.
- Connor reviews and pushes the result to the 1003 income section with one click. Manual entry works for every calculator too.

### 5. Pre-approval letters
- Letter **templates** are stored in settings with merge fields (borrower names, max price or specific address, loan type/program, down payment, expiration, LO name and NMLS, company NMLS, required disclaimers).
- Generating a letter fills the template from the file, shows a **live preview**, lets Connor edit any field for this letter, then exports a PDF. Every generated PDF is saved to the file with its version and date.
- One click makes a new version for a specific property/offer price.

### 5b. Payment estimates (from the Properties tab)
- Select **one or several homes** on the Properties tab and build a side-by-side estimate. Each column is one option: a home plus a rate, down payment (% or $), program, term, seller credit and closing-cost assumption. Comparisons can be **one home at different rates or down payments**, or **several homes on the same terms**. Up to 4 options.
- Each option shows the loan amount, LTV, P&I, taxes (from the home's tax rate), insurance, HOA, MI, total monthly payment, cash to close, and DTI using the borrower's income and debts from the 1003. Flag any option that goes over the pre-approval amount or a max-DTI setting.
- Defaults come from the file (income, debts, current scenario rate) and from settings (default closing-cost %, prepaids, MI factors by program and LTV). Every value can be overridden per option.
- All math runs in `src/lib/calc/` with tests. AI doesn't calculate. The assistant can draft the email or text that sends the comparison with a short plain-English summary ("Option B saves $212/mo but needs $14K more at closing").
- Preview it, then export a borrower-facing PDF that's saved to the file. Mark one option as recommended. Saved estimates can be reopened and duplicated.
- Every estimate carries the disclaimer: **"This is an estimate only and not a loan commitment or official Loan Estimate…"** (wording in `docs/PORTING.md`). Official Loan Estimates still come from Arive.

### 5c. Borrower documents and e-sign
- Templates and full build instructions: `docs/document-templates/README.md`. Templates include the pre-approval letter, Initial Fees Worksheet, e-sign consent, credit authorization, borrower certification and authorization to obtain information, and the Certificate of Completion.
- **Every generated document is exactly one page.** Templates are stored in the database with versions and edited in Settings → Documents. Brand logo and LO details come from Settings.
- E-sign envelopes go out through the Action Queue (Connor approves first), with one link per borrower, a code sent to contact info already on file, e-sign consent before signing, a sealed final PDF with an audit certificate, and Workflow steps updated on completion.
- No official Loan Estimates or government forms (4506-C, SSA-89) are recreated as templates.

### 6. Contract intake (transaction coordinator)
- Upload the executed purchase contract (TREC 1-4 Family Resale and the common addenda first).
- The assistant extracts:
  - **Contacts:** buyer(s), seller(s), listing and buyer's agents and brokerages, title company and escrow officer, plus the lender (MPS). Each one is matched to an existing partner record or proposed as a new one.
  - **Key dates:** effective date, option period end, financing contingency/Third Party Financing deadline, survey, appraisal, closing date, possession.
  - **Key terms:** sales price, earnest money, option fee, seller concessions, title policy payer, HOA, financing type and amount.
- After Connor reviews the extraction, the assistant:
  - writes the dates to the loan (single source of truth) and creates **tasks with due dates** for each one,
  - creates **per-contact tasks** (e.g. "Send intro + timeline to listing agent", "Order title from escrow officer", "Confirm EM receipt"),
  - drafts the emails for each contact into the Action Queue,
  - flags mismatches against the file (contract price ≠ pre-approval amount, financing amount ≠ loan amount, closing date tighter than standard turn times).
- A **Contract** section in Loan Details shows the extracted terms with source quotes.

### 7. Drafting emails and texts
- Any file can ask the assistant for a draft: "update the realtor that we're clear to close", "ask Marcus for his 2024 return", "explain why we need a letter of explanation".
- Drafts use the file's real data and the right recipient, are written in Connor's voice, and keep texts short.
- Saved message templates live in settings. AI personalizes them; it doesn't replace them.
- **Sending is a later phase** (through the GoHighLevel API). Until then, drafts can be copied, and every sent message is logged on the file.
- Every message stays compliant: no rate promises, no guarantee language, and NMLS info in email signatures.

### 8. Processing to close
- Conditions list (from the lender's approval) with status and owner. Each condition can link to documents and to a drafted request.
- Milestone updates to the borrower and agents (appraisal ordered/received, approved, CTC, closing scheduled) as one-click drafts.

### 9. After closing
- Closed-loan record: lender, rate, term, payment, closing date, insurance renewal date, escrow analysis date.
- Tracking: anniversary and annual review reminders, insurance renewal, refi opportunity flag when market rate drops a set amount below their rate, and HELOC/cash-out opportunity as equity grows.
- Partner tracking: which agents and partners sent which loans.

## Loan Info and Product Search
- Loan scenario fields: program, rate, term, amortization, comp type, lock period, selected lender and saved quotes.
- **Product Search:** deterministic, rule-based search of Connor's lender catalog. Results show eligible programs first, then excluded programs with the exact failed rule. Data model: `lenders` → `programs` (program-wide rules) → `program_matrix_rows` (occupancy, purpose, doc type, FICO min, loan amount min/max, max LTV, max CLTV, max DTI).
- No live pricing. Connor records quotes from lender portals or Arive against a program.

## Explicitly out of scope
Do not build these unless Connor asks for them by name: a call list or dialer, rate pricing, loan registration, or issuing official Loan Estimates/Closing Disclosures (Arive does these; the fee worksheet and borrower payment estimates are in scope), a general document drive (Google Drive covers it), marketing/social tools, ad dashboards, flyer generators, debt payoff simulators, property tax calculators, a visual automation builder, or any standalone "tools" page. The borrower app (MyHome) stays a separate project and integrates later.

## Design
- Visual reference screenshots are in `docs/design-reference/`. Match their layout, density and feel. **Do not copy logos, product names or another company's brand.** Use MPS Mortgage branding.
- App shell: collapsible left sidebar with only **Today, Pipeline, Borrowers, Partners, Lenders, Settings**. Primary action "New Lead" at the top; user and role at the bottom.
- Borrower profile: the loan header (metrics, milestone stepper, team) sits above everything. Sections (left file navigation on desktop, tabs on phone): **Overview** (Workflow + Action Queue), **1003** (section status + Validate), **Income**, **Fees** (fee sheet + housing expenses), **Documents**, **Notes**, **Loan** (scenario, Product Search, contract, conditions, milestone dates). Purchase files add **Properties** (with payment estimates) and **Letters**. No other tabs.
- **Loan file UI** (match `docs/design-reference/loan-file/` closely in layout and feel, with MPS colors and no copied branding):
  - **Sticky file header** across the top of every borrower page:
    - Line 1: back link "← Pipeline", the borrower name large, a small file/Arive loan number chip, a status chip (e.g. "Application"), and the next-step chip in the accent tint ("Send disclosures · Loan Officer · 3d").
    - Line 2: "Updated <date>", a Hide/Show details toggle, Save, and Change Status.
    - The metrics strip is a row of label-over-value cells (small uppercase grey label, large bold value) separated by thin vertical dividers. The credit score shows a colored dot by tier. On narrow screens the strip scrolls sideways inside its own container.
  - **Milestone stepper:** numbered circles joined by a thin line, with the label under each circle. A completed step is a filled circle with a check and its date under the label. The current step is outlined in the accent color. Future steps are grey. A failed step (e.g. "Document check failed") is shown in red. Below it, a full-width light-tint band shows file state ("Loan open").
  - **Assigned team row:** a rounded pill container labelled "Assigned team 2/4", holding grouped role chips (Broker, Loan Officer, Processor, Lender AE). A filled dot means assigned; a hollow dot plus italic "Unassigned" means open. Each chip is a dropdown.
  - **Left file navigation** (desktop) replaces horizontal tabs inside a loan file. Each item is an icon plus label: Workflow/Overview, 1003, Income, Fees, Documents, Notes, Loan, plus Properties and Letters for purchase files. Items carry status markers: a red count badge for missing items (1003 missing fields), a green check when complete, and an amber dot when something needs review. A collapse button hides the nav. On phones it becomes a horizontally scrolling tab bar under the header.
  - **Next-step card:** a light accent-tinted card with an icon tile on the left, a small uppercase eyebrow ("DISCLOSURE & SETUP · YOUR NEXT STEP"), a bold title, a one-line explanation, and one solid primary button on the right. Below a divider, "ALSO READY FOR YOU" lists 2–4 rows, each with an icon, label and an outlined secondary button.
  - **Progress overview card:** four columns (Origination, Disclosure & Setup, Underwriting, Closing & Funding), each a segmented bar with one segment per step. Done segments are filled, ready segments are accent, and blocked segments are red. Under each bar: "3/7 · 2 ready". The current group is marked with a dot. A summary line reads "3 of 20 steps complete · now on Send Disclosures, waiting on Loan Officer".
  - **Step groups** are accordions with the group name, "x/y" and a "2 ready" chip. The open group is highlighted with an accent border and a "You are here" pill. It shows a "Waiting on <owner> · <n> days at this step" strip, then step rows: an icon, the step name, an owner subtitle, a status pill (Ready = accent tint, Not started = grey outline, Not applicable = grey, Blocked = red tint with a lock icon, Done = green check), and an outlined action button on the right. Blocked rows show the reason in red text under the name.
  - **1003 tab:** an "Applications · 1 application, 1 borrower ›" bar with a solid green **Validate Application** button beside it. Then a URLA sections card listing each section with a status on the right: a yellow badge with the missing count, a green check for complete, or a dashed circle for not started. Clicking a section opens its form below in a card, using the standard form grid, with a read-only summary box at the bottom (program, price, value, LTV, DTI) and a Save button for that section.
  - **Fees tab:** a "Fee summary" card in two columns (Loan costs B and D on the left, Other costs F, G and I on the right) with right-aligned amounts, then a highlighted full-width row for **J. Total closing costs**, a small grid (total fees, borrower paid, seller paid, lender paid), and a highlighted **Estimated cash to close** row. Below that, a "Lender-paid originator compensation" card, then one card per section (A–H) with the section title, a count, an "Add fee" button and a table (fee name with small tags such as APR, FHA, Shoppable, Third party; paid to; paid by; amount). Empty sections say "No fees in this section."
  - Overall look: dark navy app bar, a very light cool-grey page, white cards with 1px borders and generous rounding, one accent blue for current and ready states, green only for done and validate, red only for blocked and missing. Small uppercase grey labels, bold dark values, tabular numbers for money.
- AI output always has a clear visual treatment: an "Assistant" label, source quote on hover or expand, and Approve, Edit and Dismiss buttons.
- Forms: responsive grid of up to 6 columns, compact inputs, required fields marked `*`, calculated fields read-only and greyed out. Boolean flags are toggle chips.
- Build shared components first (Input, Select, CurrencyInput, PercentInput, ToggleChip, Card, SummaryBar, DataTable, Tabs, EmptyState, **QueueItem**, **SourceQuote**, **ReviewField**) and use them everywhere.
- Mobile: Today, Pipeline, borrower Overview, Notes (call notes entry) and approving queue items must work well on a phone.

## Build phases
0. **Foundation** (in progress): repo, Supabase dev project, auth, org/user model with RLS, app shell, shared components, calc library with tests.
1. **Pipeline and borrower record:** stages, stage history, purpose-aware profile shell, Overview, Notes, Today view, tasks.
1b. **Loan file workspace:** loan header (metrics, milestone stepper, assigned team), Workflow with step templates and blocking rules, 1003 section status and Validate Application (on whatever 1003 fields exist so far; it grows in Phase 6).
2. **Assistant core:** Edge Function wrapper for Claude with schema-validated outputs, `ai_runs` log, Action Queue, and drafted messages with templates. Prove it end to end with "draft a follow-up text."
3. **Contract intake** (priority feature): port the old extraction (see `docs/PORTING.md`), then add the review screen, partner matching, dates → tasks, per-contact tasks and drafts, and mismatch flags.
4. **Call notes → pre-qual** with field-by-field review and the readiness result.
5. **Lead intake** from mps.mortgage forms with duplicate check and first-touch drafts.
6. **1003 + MISMO 3.4** import/export (test round-trip into Arive).
7. **Documents:** checklist rules, requests, upload, classification. Then **AI income calculators** with push-to-1003.
8. **Fees, letters, documents and estimates:** fee sheet with smart defaults and housing expenses; document templates (letters, worksheet, disclosures) with live preview, one-page PDF and versioning; e-sign envelopes; then payment estimates from the Properties tab (one or more homes, different rates and down payments) with PDF and drafted send-off message.
9. **Loan Info + Product Search + lender admin. Conditions and milestone updates.**
10. **After closing:** closed-loan tracking and reminders.

## Later
Sending via GoHighLevel SMS/email (two-way, logged on the file), scheduled follow-up sequences (with locks, pause state and failure circuit breaker), a read-only guideline assistant grounded on uploaded lender guidelines, comp/revenue ledger, and MyHome integration.
