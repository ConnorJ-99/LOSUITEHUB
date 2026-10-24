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

## Later (not now)

GoHighLevel SMS/email bridge, automations engine (with locks, pause state and failure circuit breaker), closed-loan monitoring and nurture, partner/realtor management, revenue and comp ledger, AI tools (contract review, income document review), a guideline assistant (read-only chat grounded on uploaded lender guidelines and the program catalog, always citing the source document), and the MyHome borrower app integration.
