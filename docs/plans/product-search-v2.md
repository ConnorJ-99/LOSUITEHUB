# Plan: Product Search v2 (lender matrix engine, search, catalog and borrower pricing)

Status: ready to build after the current pricing work is finished
Owner: Connor
Mockups: `docs/design-reference/product-search-v2/01–09*.png`

## 1. Why this matters
Connor spent five hours finding one lender with one product for one borrower. The goal: **any scenario → the right programs from every lender in under 30 seconds**, with the guideline text on screen to confirm it.

The old SmartMatch failed in three ways, and this plan fixes each one:
1. **Wrong product types in results** (a DSCR closed-end second returned FHA down payment assistance). Fix: a hard **product-type gate** before any matching (section 4.1).
2. **Flat matrix fields** (one max LTV per program) couldn't represent real matrices where LTV depends on credit, loan amount, occupancy and property type together. Fix: store every matrix **cell** (section 3.3).
3. **Hand-entered catalog, rarely updated.** Fix: AI-assisted import of the lender's matrix PDF and guidelines, with Connor reviewing before anything is saved (section 5).

## 2. What Connor gets
1. **Search by parameters** (no AI, no credits): pick the loan type first, fill in the scenario, get results. (Mockup 01, 03)
2. **Ask the assistant** (uses AI only to read the sentence and answer guideline questions): type the scenario in plain English, check the fields it read, and the same rule-based search runs. Ask follow-up questions and get answers quoted from the guidelines with page numbers. (Mockup 02)
3. **Results as cards**, with ineligible programs of the same type ranked by closest fit and "how to fit" suggestions. (Mockup 03)
4. **Program detail drawer:** matrix grid with the borrower's cell highlighted, requirements checklist and guideline text with citations. (Mockup 04)
5. **Browse all programs** without a scenario, filtered by product type, lien, lender status and quick limits, plus full-text search across guideline text. (Mockup 05)
6. **Lender status**: Approved, Application pending or Not signed up. Not-signed-up lenders still show up, with a warning to check with the lender. (Mockups 03, 05)
7. **Borrower pricing comparison:** add selected programs to a borrower, enter each lender's quote, compare and sort by best rate, lowest cash to close, lowest payment or lowest 5-year cost, see break-even math, and choose one. Works on a **TBD scenario** with no property. (Mockups 06, 07)

## 3. Data model

### 3.1 Lenders
`lenders`: name, short name, logo, **status** (`approved`, `pending`, `not_signed_up`, `inactive`), channel (wholesale, correspondent, non-del), AE name/phone/email, portal URL, comp notes, states licensed, notes, created/updated.

### 3.2 Programs and the product-type taxonomy
`programs`: lender, name, **product family** (`conventional`, `fha`, `va`, `usda`, `jumbo`, `non_qm`), **lien** (`first`, `ces`, `heloc`), **doc types** allowed (`full_doc`, `bank_statement_12`, `bank_statement_24`, `1099`, `pnl_only`, `asset_depletion`, `dscr`, `wvoe`, `no_ratio`), **features** (`dpa`, `itin`, `foreign_national`, `interest_only`, `non_warrantable_condo`, `manufactured`, `buydown`, `recent_credit_event`, `first_time_investor`, `str_income`, `homeready_possible`, ...), purposes, amortizations/terms, prepay options, status (active/retired), matrix effective date, last verified date, guideline document links.

The taxonomy is a fixed list in code (`src/lib/products/taxonomy.ts`), not free text, so every program and every search uses the same words. Adding a feature means adding it to the list.

### 3.3 Matrix cells (the core)
`program_matrix_cells`: one row per cell in the lender's grid:
- dimensions: `occupancy` (primary, second, investment), `property_type` (SFR/PUD, condo, non-warrantable condo, 2–4 unit, manufactured, mixed-use), `units_min/max`, `purpose` (purchase, rate/term, cash-out), `doc_type`, `fico_min`, `fico_max`, `loan_amount_min`, `loan_amount_max`, optional `dscr_min`, optional `citizenship`
- limits: `max_ltv`, `max_cltv`, optional `max_dti`, `reserves_months`, `notes`
- provenance: `source_document_id`, `source_page`, `extracted_by` (ai/manual), `approved_by`, `approved_at`

A cell left blank in the lender's grid ("—", "N/A") is stored as **not offered**, never as zero.

### 3.4 Program rules (everything that isn't a grid cell)
`program_rules`: typed, machine-checkable rules, each with a plain-English message and a citation:
- `field` (e.g. `dti`, `reserves_months`, `mortgage_lates_12`, `bk_seasoning_months`, `state`, `citizenship`, `self_employed_years`, `loan_amount`, `dscr`, `units`, `first_time_buyer`, `income_vs_ami`)
- `op` (`<=`, `>=`, `in`, `not_in`, `required`, `between`), `value`, optional `applies_when` (e.g. only for cash-out, or only above 95% LTV)
- `severity`: `hard` (makes the program ineligible) or `verify` (shows "Verify" in the checklist)
- `message` ("Max DTI 50%"), `source_document_id`, `source_page`, `source_quote`

### 3.5 Overlays
`overlays`: rules that apply across programs, e.g. **Texas §50(a)(6)** (homestead cash-out capped at 80% CLTV) or a company overlay Connor sets. These are applied by the engine after the matrix lookup.

### 3.6 Guideline documents and searchable text
- `guideline_documents`: lender, program(s), type (matrix, guidelines, overlay bulletin, rate sheet), file in a private storage bucket, version, effective date, uploaded date, page count, SHA-256, status (current/superseded).
- `guideline_passages`: the document's text split by **section headings** (not fixed-size chunks), each with page number, section number/heading and text. Indexed with Postgres full-text search (`tsvector`).
  - Browse search and the drawer's "Search this guideline" use full-text search: no AI, no credits.
  - The assistant answers guideline questions by retrieving the top passages with full-text search (optionally embeddings later) and quoting them with page and section. If nothing relevant is found, it says so instead of guessing.
- "Open PDF at page" opens the stored original file to the cited page.

### 3.7 Borrower shortlist and quotes
- `loan_program_options`: loan, program, added from (search id), status (shortlisted, quoted, chosen, removed), sort order.
- `loan_quotes`: option, **scenario** (`tbd` or a saved property id), rate, lock days, points/price, lender credit, total closing costs (or link to a fee sheet), monthly MI, quote date, source (manual, uploaded quote PDF), notes.
- `pricing_scenarios`: loan, label ("TBD purchase"), price/value, down payment, loan amount, term, taxes rate, HOI, HOA. A TBD scenario has **no property**. Saved homes can be used instead.
- Choosing an option writes the selected lender/program/rate to the loan (single source of truth) and completes the Workflow step "Select lender/program".

## 4. Search engine (pure functions in `src/lib/products/`, fully unit-tested)

Input: a `Scenario` object (the same shape from the form, the assistant or the borrower file).

### 4.1 Product-type gate (hard filter, runs first)
Only programs whose **lien**, **product family**, **doc type** and any required **features** match the scenario are considered. Examples:
- DSCR closed-end second → lien `ces` + doc `dscr` only. FHA, VA, conventional, first-lien DSCR and DPA are never evaluated.
- "Conventional 5% down, 720" → family `conventional`, lien `first`, doc `full_doc`. DPA programs are excluded unless the `dpa` feature is selected.
- Product family "Any" widens the family but keeps lien and doc type.
The results page always states what was searched and what was excluded ("42 programs of other types were not searched"), with a "Widen" button.

### 4.2 Program-level rules
Check `program_rules` and lender status/states. Hard failures make the program ineligible; `verify` items show in the checklist.

### 4.3 Matrix lookup
Find the cell(s) matching occupancy, property type, units, purpose, doc type, FICO band and loan amount tier. Compare the scenario's LTV (1st lien) or CLTV (2nd lien/HELOC) against the cell's max. Apply overlays (e.g. Texas 80% cap). Output: `fits`, `cell`, `max_ltv_or_cltv`, `room` (percentage points and dollars), and max loan/cash at this FICO.

### 4.4 Ranking
- Eligible: by most room left (best fit), with badges for lowest FICO floor and highest max loan. Approved lenders first by default; not-signed-up lenders shown with a warning badge (toggle to hide).
- Ineligible (same product type only): by number of failed rules, then by normalized gap.

### 4.5 "How to fit" suggestions (calculated, not AI)
For near misses, solve for the change that makes it fit:
- lower the loan amount (max loan or cash at the current FICO and value),
- more down payment,
- a different FICO band ("needs 680, +28"),
- a different doc type or occupancy, only if the borrower's flags allow it.
If no single change fixes it, say so: "No change in this scenario fixes it."

### 4.6 Performance
The whole catalog (a few hundred programs, tens of thousands of cells) can be searched in one database query plus in-memory evaluation in well under a second. Search results are logged (`product_searches`: scenario, result ids, user, time) for "Recent searches" and for checking accuracy later.

## 5. Importing a lender (where the AI work happens: once per document, not per search)

1. **Add lender**: name, status (Approved / Pending / Not signed up), AE, portal.
2. **Upload documents**: matrix PDF(s), full guidelines PDF, overlay bulletins. Files are stored and hashed, and text is extracted and split into passages right away (no AI needed for this part).
3. **AI extraction** (Claude, through the existing edge-function wrapper, logged in `ai_runs`):
   - From the **matrix**: programs, their product type, lien, doc types and features (using the fixed taxonomy), and every grid as cells. Each cell includes the source page.
   - From the **guidelines**: program-level rules with quotes, and a short program description plus "who it's for", each paragraph citing page and section.
4. **Review screen** (required before saving): the PDF page on the left and the extracted grid on the right in the same layout, with differences highlighted. Connor can edit any cell or rule, mark it verified, and approve the program.
5. **Automatic checks** before approval:
   - LTV never increases as FICO decreases within the same column, and never increases as the loan amount increases.
   - No impossible values (LTV > 100, FICO outside 300–850, negative amounts).
   - Every program has at least one cell and a product type.
   - The cell count matches the grid size found on the page.
   Failures are shown as warnings to fix.
6. **Updates**: uploading a newer matrix creates a new version and shows a **diff** ("Primary 680–699 ≤$1M: 85% → 80%"). Older versions are kept, and searches always use the current approved version.
7. **Stale warning** when a matrix hasn't been verified in 45 days (configurable).

Golden tests: Connor provides 2–3 real lender matrices, and for each one 10 scenarios with the answer he knows is right. These become automated tests that run on every change to the engine.

## 6. Screens (see mockups)
- **01 Search by parameters**: step 1 "What kind of loan?" (lien, product family, doc type, must-have features), step 2 scenario grid (pre-filled from a borrower or blank), lender status toggles, and the search bar stating how many programs of this type will be searched and that no AI is used.
- **02 Ask the assistant**: chat. The assistant shows "I read this as" chips (editable), states which product types were searched and excluded, and shows compact results with fit/close badges and checkboxes. Guideline answers quote the lender's text with page citations and an "Open guideline at p.X" button. A usage panel shows AI messages vs. free searches.
- **03 Results**: scenario bar, eligible program cards (fit badge, stat tiles, room bar, lender status), ineligible panel of the same type with closest fit and "how to fit", an "other types not searched" banner, and a selection bar with "Add to <borrower> for pricing".
- **04 Program detail drawer**: slides out from the card. Tabs: Matrix, Requirements, Guidelines, Documents. Matrix filters are preset to the scenario, with the borrower's cell highlighted, then the fit line, the requirements checklist and guideline passages with citations.
- **05 Browse all programs**: left filters (product type with counts, lien, lender status, quick limits), a search box over programs, lenders and guideline text, programs grouped by product type, and a stale-matrix warning.
- **06 Borrower → Loan → Pricing (empty)**: lender cards with only the lender and program until pricing is entered, a pricing scenario selector (**TBD, no property** or a saved home), and quote entry (rate, lock, points, lender credit, total closing costs or "use fee sheet", MI, date) or upload of a quote PDF for the assistant to read.
- **07 Pricing comparison (filled)**: sort by Best rate, Lowest cash to close, Lowest payment or Lowest 5-year cost. The winner for the active sort gets a **green outline and banner**; other category winners get orange chips/outline. Each card shows cash to close, P&I, MI, taxes and insurance, total payment and 5-year cost. "What the numbers say" shows break-even math between options. Actions: Choose, Save comparison, Create borrower estimate PDF (all options), Draft summary to borrower.

- **08 Lenders**: summary tiles (lenders, approved, pending/not signed up, programs, needs attention), status tabs, search, "offers" filters by product type. Lender cards show status, channel and states, product-type counts, programs, your loans YTD, matrix date (green when current, orange when stale), AE, and banners for "new matrix waiting for review" or "stale matrix".
- **09 Lender detail**: header with status, comp, matrix version, your loans, average app-to-close and AE contact. Tabs: Products, Documents, Overlays & notes, Contacts, Loans. Products shows a table grouped by product type (lien, min FICO, max LTV/CLTV, loan range, occupancy, verified date), filter chips, and a search box over this lender's guidelines; clicking a program opens the same drawer as Product Search (04). The side panel shows documents with versions and what was extracted, the last matrix update's diff, Connor's private notes about the lender, and contacts.

## 7. Pricing math (pure functions in `src/lib/calc/`, tested)
- P&I from rate, term and loan amount; total payment = P&I + MI + taxes + insurance + HOA.
- Cash to close = down payment + closing costs (incl. points) − lender credits − seller credits − earnest money.
- 5-year cost = cash to close + 60 × (P&I + MI). The horizon is configurable (3, 5 or 7 years).
- Break-even between two options = difference in up-front cost ÷ difference in monthly cost, in months and years. Show "never" when one option is cheaper on both.
- Sorting ties break by the next metric (rate → cash to close → payment).

## 8. Changes to existing spec
- **Payment estimates (5b)** must work on a **TBD scenario** (no property), not only saved homes. The same `pricing_scenarios` table feeds both.
- **Sidebar**: add **Product Search** as its own item between Partners and Lenders. Lenders keeps lender admin (add/edit lenders, upload documents, review imports).
- The Product Search section in CLAUDE.md points to this plan.

## 9. Build order (each step ends with tests, a click-through summary and a commit)
1. Taxonomy + tables (3.1–3.7) with RLS and seed data for 3 fictional lenders.
2. Search engine (4.1–4.5) as pure functions with golden tests, including the DSCR-CES-never-returns-FHA test.
3. Search by parameters screen + results cards + ineligible panel (01, 03).
4. Program detail drawer with matrix grid, requirements and guideline passages (04).
5. Lender admin: add lender with status, upload documents, text extraction and passage indexing, full-text search.
6. AI import + review screen + automatic checks + versioning/diff (section 5). Test on Connor's real matrices.
7. Browse all programs (05), the Lenders page and lender detail (08, 09).
8. Borrower shortlist, quotes, TBD pricing scenarios, comparison and sorting, choose program (06, 07), and estimate PDF from the comparison.
9. Ask the assistant: scenario parsing into the same `Scenario` shape (schema-validated), guideline Q&A over passages with citations, usage counter (02).

## 10. Acceptance criteria
- A DSCR closed-end second search never evaluates or shows FHA, VA, conventional, first-lien or DPA programs.
- "Conventional, purchase, 5% down, 720, primary SFR" returns every approved conventional 1st-lien program that fits, in under 1 second, with no AI call.
- Every eligible or ineligible result can be traced to a specific matrix cell or rule with a source page.
- Ineligible results show the exact failed rule and, where possible, a calculated "how to fit".
- Not-signed-up lenders appear with a clear warning and can be hidden.
- Clicking a card opens the drawer with the borrower's matrix cell highlighted and the guideline text cited.
- A lender's matrix PDF can be imported, reviewed against the PDF and approved, and a newer version shows a diff.
- In the borrower profile, three quotes on a TBD scenario sort correctly by each metric, the winner is outlined green, and break-even values match hand calculations.
- The assistant's guideline answers always include a citation, or say the guidelines don't cover it.

## 11. Open questions for Connor
- Which 2–3 lenders should be imported first for the golden tests? (Bring their matrix PDF and guidelines.)
- Do you want company overlays (e.g. your own minimum FICO) applied on top of lender matrices?
- 5-year cost horizon: 5 years by default, or something else?
- Should "Not signed up" lenders show by default or be hidden by default?
