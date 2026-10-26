# LOSuite v2 — Project Guide for Claude

## What this is

LOSuite is the internal CRM for MPS Mortgage LLC (NMLS #2501110), a mortgage brokerage in Dallas-Fort Worth, Texas. It tracks a person from lead → client → closed loan, and keeps them after closing for nurture and repeat business.

The owner (Connor) is a licensed loan officer, not a software engineer. Explain decisions in plain English, keep changes small, and never assume he can debug code by hand.

Arive remains the production LOS (disclosures, submission, underwriting). LOSuite is the CRM and front-end workspace. It does not replace Arive.

## Stack

- React + TypeScript + Vite, Tailwind, shadcn/ui
- Supabase (Postgres, Auth, Storage, Edge Functions)
- PDF generation: @react-pdf/renderer (or equivalent; propose before choosing)
- Deploy target: Vercel (later)
- Approved additions: Vitest (unit tests), React Router (page navigation), TanStack Query (data loading/saving), @dnd-kit (pipeline drag and drop)

## Hard rules

1. Never connect to the production Supabase project. Build against the dev project in `.env.local` only. Data migration from the old app happens at the end, through a reviewed script.
2. Every relationship has a real foreign key with an explicit `on delete` rule. No orphaned records. The old app had about 40% of borrower records pointing to deleted leads.
3. One person, one record. A lead becomes a client by changing stage, not by copying into a new table. Repeat and refi clients link to their prior loans.
4. One source of truth per value. Purchase price, loan amount, rate, closing date, insurance date and so on live in one place. Every screen reads and writes that place. No duplicated fields across tabs.
5. All mortgage math lives in pure, unit-tested functions (`src/lib/calc/`): LTV, CLTV, PITI, DTI, income calculations, cash to close. No math inside components.
6. Row Level Security on every table from day one, scoped by organization and user, so it is ready for future loan officers.
7. Work in small phases. At the end of each phase: run tests, run the app, summarize what to click through, then commit.
8. Before adding a new library, table or major pattern, explain why in one or two sentences and wait for approval.

## Decisions log

Choices Connor has approved. Follow them unless he changes them.

- **No Social Security numbers, ever.** LOSuite does not store SSNs, including the last 4. The 1003 has no SSN field, MISMO export omits it (Connor adds it in Arive), and MISMO import discards any SSN in the file without saving it.
- **Account numbers: last 4 digits only** for bank, investment and credit accounts.
- **Notes belong to the person**, tagged with the loan they were written on.
- **Values live in one place:** deal facts on `loans`, home facts on `properties`, existing mortgages on `property_liens`, person facts (identity, addresses, employment, other income) on the contact, application facts (assets, liabilities, declarations, demographics) on the loan.
- **Phase 3 is split** into 3a (1003 data and tab), 3b (MISMO 3.4 export) and 3c (MISMO 3.4 import), each tested and committed separately.
- **MISMO 3.4 export follows Fannie Mae's ULAD layout** (`src/lib/mismo/`). Structure, element order, xlink relationships and most enumerations are confirmed against the MISMO reference model and the GSEs' ULAD xlink guide. Values that couldn't be confirmed publicly are marked "best effort" in `maps.ts` (asset types, military status, seller-relationship and both-sexes ULAD extensions). Lender credits and title vesting are not exported yet. A real Arive import is the final test; adjust `maps.ts` based on what Arive does.
- **MISMO import replaces, never merges** the imported borrowers' addresses, jobs and other income, and the loan's assets and liabilities, so re-importing a file gives the same result. Person fields are only written when the file has a value. The loan purpose is never changed by an import. Existing liens keep their rate, closing date and Texas cash-out flag (MISMO doesn't carry them). Properties are matched by address. SSNs in a file are counted and discarded.
- **Income worksheets keep their inputs; the 1003 keeps the figure.** Each worksheet (`income_worksheets`) saves the numbers typed from pay stubs, W-2s, returns or bank statements, so the math can be reopened. "Push to 1003" copies the result into one place: the job's income field (base, overtime, bonus, commission or self-employed) or, for rentals, the property (monthly rent for the 75%-of-lease method, or `schedule_e_monthly_income` with `rental_income_method = schedule_e`). The worksheet shows when the 1003 no longer matches. Self-employed income follows Fannie Mae Form 1084 add-backs and the two-year rule (average if steady or rising, most recent year if declining, flag a 20%+ drop). Declining overtime/bonus/commission uses the lower current rate.
- **Phone prequal = a short 1003 on the same records.** The Prequal tab edits a draft and Save writes only what changed into the loan, `loan_borrowers.estimated_credit_score`, jobs, other income, debts and assets. Tax rate, insurance and HOA estimates on the loan apply only where the subject property has no figure. Suggested defaults (conventional, 30 years, 2.2% tax, $3,600 insurance) count as unsaved until Save. Max DTI defaults: Conventional 45%, FHA 50%, VA 50%, USDA 41% (not saved).
- **Mortgage insurance counts in every payment** (Overview, 1003, Income, Prequal) through one shared scenario setup (`loanScenarioInput`). Defaults: conventional over 80% LTV 0.5%/yr; FHA 0.55%/yr (0.50% at 95% LTV or less) + 1.75% financed; VA funding fee 2.15% / 1.5% / 1.25% by down payment, 0 if exempt; USDA 0.35%/yr + 1%. `mi_rate_pct` and `upfront_fee_pct` override them. The MISMO export still sends the base loan amount; Arive figures UFMIP and funding fees itself.
- **Product Search design approved (2026-10-25)** for Phase 9: `lenders`, `programs`, `program_matrix_rows`, `program_rules` (rules as rows, each with a citation), `program_documents` + `program_text_blocks`; pure search functions in `src/lib/search/` with Marcus's test cases; components and mockup notes. Full spec: `docs/product-search-design.md`.
- **Every database script is safe to re-run and ends with a confirmation row** ("LOSuite … installed"). Connor pastes scripts into the Supabase SQL Editor, where highlighted text silently runs only part of a script and still says "Success". Test each script in PGlite (run twice, and a partial run followed by a full run) before handing it over.

## Core concepts

### Pipeline stages

Lead → Contacted → Pre-Qualified → Pre-Approved → Under Contract → Submitted/Processing → Approved/Clear to Close → Closed. Side stages: Nurture (not ready yet) and Lost (with a reason). Stage changes are logged with a timestamp.

### Loan purposes, each with its own profile layout

The borrower profile adapts to the loan purpose. Shared core, with purpose-specific sections shown or hidden:

- **Purchase:** properties of interest, pre-approval letters, realtor/partner, contract dates.
- **Refinance (rate/term and cash-out):** current loan details (balance, rate, payment, lender, origination date), cash-out amount, net tangible benefit. Flag Texas §50(a)(6) homestead cash-out rules (80% CLTV cap, 12-day notice, 1-year seasoning).
- **HELOC / HELOAN (2nd liens):** 1st lien balance is required. CLTV is the qualifying ratio, not LTV. Texas homestead rules apply.
- **Investment / DSCR:** subject property rent, DSCR calculation, entity vesting (LLC), number of financed properties.

### Borrower profile tabs (Phase 1 scope)

1. **Overview:** stage, purpose, key numbers, next task, last contact, assigned LO, partner/referral source.
2. **1003:** full Uniform Residential Loan Application (URLA), sectioned like the real form. MISMO 3.4 XML import and export, targeting a file that imports cleanly into Arive. Support co-borrowers.
3. **Income calculator:** W-2/salary, hourly with overtime/bonus averaging, self-employed (Schedule C, 1120S, 1065 with K-1s), bank statement (12/24 months with expense factor), rental (Schedule E and 75% of lease), DSCR. The result can be pushed to the 1003 income section with one click.
4. **Notes:** timestamped notes, pinned notes, activity log of stage changes.
5. **Properties:** homes the borrower is interested in (address, price, taxes, HOA, insurance estimate, listing link, status). Any property can become the subject property.
6. **Documents / PDFs:** generate pre-approval letters (borrower names, max price or specific address, loan type, expiration, LO name and NMLS, company NMLS, required disclaimers) and save every generated PDF to the borrower's file.
7. **Loan Info:** the loan scenario (program, rate, term, amortization, comp type, lock period), the Product Search below, and the selected lender with saved quotes.

### Product Search (pricer-style)

- Scenario form fields: loan type, purpose, cash-out amount, appraised value, loan amount, 1st lien balance (if 2nd), LTV and CLTV (auto-calculated, read-only), FICO, occupancy, income doc type, DTI, property type, product/term, amortization, citizenship, ZIP/state/county, escrows, lock period, late mortgage payments, BK/FC/SS/DIL with seasoning, rural and declining-market flags, and toggle chips for self-employed, FTHB, ITIN and non-occupant co-borrower.
- Pre-fills from the borrower's 1003 and Loan Info. Edits can be saved back to the loan.
- Search is deterministic and rule-based, not AI-scored. Results show eligible programs first, then excluded programs with the exact failed rule (e.g. "Max CLTV 80% at 656 FICO, scenario is 81%").
- Data model: `lenders` → `programs` (program-level rules: states, citizenship, property types, credit events, doc types) → `program_matrix_rows` (occupancy, purpose, doc type, FICO min, loan amount min/max, max LTV, max CLTV, max DTI).
- Admin screen to add and edit lenders, programs and matrix rows without code.
- Pricing v1: no live pricing. The LO can manually record a quote (rate, price/points, lender credit, lock period, date) against a program and save it to the loan. Leave room in the schema for imported rate sheets or a pricing engine API later.
- Scenarios can be saved to history on the borrower and re-run.

## Design

- Visual reference screenshots are in `docs/design-reference/`. Match their layout, density and feel. Do not copy logos, product names or another company's brand. Use MPS Mortgage branding.
- App shell: collapsible left sidebar nav with the primary action ("New Lead") at the top and the user and role at the bottom.
- Forms: responsive grid of up to 6 columns, compact inputs, required fields marked `*`, calculated fields read-only and greyed out.
- Boolean flags are toggle chips, not checkboxes.
- Long forms get a sticky bottom summary bar with the key figures and one primary action.
- White cards on a light grey background, one accent color, thin borders, generous whitespace.
- Build shared components first (Input, Select, CurrencyInput, PercentInput, ToggleChip, Card, SummaryBar, DataTable, Tabs, EmptyState) and use them everywhere.
- Mobile: pipeline, borrower overview and notes must work well on a phone.

## Build phases

0. **Foundation:** repo setup, Supabase dev project, auth, org/user model with RLS, app shell, shared component library, calc library with tests.
1. **Contacts and pipeline:** lead capture, borrower record, stages, pipeline board and list views, search and filters, stage history.
2. **Borrower profile shell:** purpose-aware layout, Overview, Notes, Properties.
3. **1003 + MISMO 3.4 import/export.** Test round-trip into Arive.
4. **Income calculator** with push-to-1003.
5. **Loan Info + Product Search + lender admin.**
6. **PDF generators:** pre-approval letter first.

## Direction (2026-10-25)

Connor wrote a v3 guide built around an AI assistant whose work lands in an Action Queue for his approval, plus a Today view. It is saved as `docs/project-guide-v3-draft.md` and kept alongside this guide for now. Agreed so far: the next phase is the assistant core (Claude called only from a Supabase Edge Function, schema-validated outputs, an `ai_runs` log, the Action Queue and the Today view, proven with "draft a follow-up text"), and the Prequal tab stays as its own tab. Follow the draft's AI rules (AI never sends or saves on its own, sources and confidence on every extraction, every run logged) for any AI work.

**Still to set up (Connor, later):** the assistant core part 2b is built and committed but not live. To turn it on: add `ANTHROPIC_API_KEY` under Supabase → Edge Functions → Secrets, run `npm run function:paste`, and deploy `supabase/.paste/assistant.ts` as a function named `assistant` (Via Editor). Then test "Draft a follow-up" end to end on a test file. Until then, the button shows "not deployed yet" and every AI feature built on the same function can't be tested live.

## Must build (requested, not yet scheduled)

- **Phone prequal tool**: built 2026-10-25 as the Prequal tab, with the old app's upgrades (buying power at 43/45/50%, payoff toggle, use-all-for-down, keep/rent/sell for owned homes, savings use-as, depletion income and reserves). See `docs/old-app-comparison.md` for the rest of the old app.

## Later (not now)

GoHighLevel SMS/email bridge, automations engine (with locks, pause state and failure circuit breaker), closed-loan monitoring and nurture, partner/realtor management, revenue and comp ledger, AI tools (contract review, income document review), a guideline assistant (read-only chat grounded on uploaded lender guidelines and the program catalog, always citing the source document), and the MyHome borrower app integration.
