# Product Search: approved design (Phase 9)

Approved by Connor on 2026-10-25. Build this in Phase 9 (Loan Info + Product Search + lender admin).
Target mockup: `docs/design-reference/product-search/product-search-mockup.png` (lenders in it are fictional sample data). Match its layout with MPS branding.

Search is deterministic and rule-based. All eligibility, matrix lookups, room-left and "how to fit" math are pure, tested functions in `src/lib/search/`. No AI in the search. Program descriptions and matrix rows come from lender admin; the AI matrix import proposes them from the lender's PDF, and nothing is saved until Connor approves it.

## Tables (all new)

Each gets Row Level Security scoped to the organization, a re-runnable script and a confirmation row.

### `lenders`
Name, logo, account executive name / phone / email, lender portal link.

### `programs`
One per lender program.
- `lender_id`, name.
- `category`: conventional, fha, va, usda, non_qm. The "2nd lien", "HELOC" and "DSCR" chips come from what the matrix offers.
- `loan_amount_basis` for 2nds: `this_lien` (the new 2nd alone) or `combined` (1st + 2nd). Lenders differ on which amount picks the matrix column.
- Bank statement months offered (12/24), expense factor, interest-only, 40-year, prepayment penalty options.
- Guidelines last verified date, matrix PDF link.

### `program_matrix_rows`
One row = one cell of the lender's grid.

| Field | What it holds |
|---|---|
| `fico_min`, `fico_max` | Credit score band (e.g. 640–659) |
| `loan_min`, `loan_max` | Loan amount tier ($0–$150,000) |
| `occupancies` | List of the existing `occupancy` enum |
| `property_types` | List of the existing `property_type` enum ("SFR/PUD" = single_family + townhouse) |
| `product` | first_lien, closed_end_second, heloc |
| `doc_types` | List: full_doc, bank_statement, form_1099, p_and_l, asset_utilization, dscr |
| `purposes` | List: purchase, rate_term, cash_out |
| `max_ltv`, `max_cltv` | Blank = "—" (not offered) |
| `max_dti`, `max_cash_out`, `min_reserves_months` | Only when this cell has its own limit |
| `document_id`, `page` | Citation into the lender's PDF |
| `ai_run_id` | Set when the row came from an approved AI import |

Lists let one row cover "Purchase & rate/term, SFR/PUD", which keeps the row count small.

### `program_rules`
Program-wide rules, one row each, from a fixed set of rule types:
loan amount range, max DTI, minimum credit score, mortgage history (e.g. 1×30×12), BK/FC/SS seasoning, years self-employed, reserves (and whether cash-out may count), states allowed, citizenship, Texas §50(a)(6) (allowed; 1 year since any prior §50(a)(6) loan).
Each rule has its value(s) plus a citation (document, page, section). Rows instead of columns so the requirements checklist walks the list and every rule carries its own source.

### `program_documents` and `program_text_blocks`
- `program_documents`: the lender's guideline PDFs in a private storage bucket (title, revision such as "rev. 09/2026", verified date).
- `program_text_blocks`: program, section (description, who_its_for, eligible, ineligible, income_qualification, matrix_notes), position, paragraph text, citation (document, page, section such as "§4.2"). Drives the citation chip on each paragraph.

The Texas §50(a)(6) 80% CLTV cap is state law, applied in code to every program, not stored per lender.

## Functions (`src/lib/search/`)

1. **LTV / CLTV**: this lien ÷ value; (1st lien + this lien) ÷ value. Compare unrounded; round only for display.
2. **Texas cap**: Texas + homestead + cash-out → 80% CLTV cap, else none.
3. **Matrix cell**: the row matching occupancy, property type, product, doc type, purpose, credit band and loan tier. None = not offered. Overlapping rows: the lower limit wins, and lender admin warns about the overlap.
4. **Effective max**: lowest of the matrix cell, the Texas cap and program rules, remembering which one set the limit.
5. **Max loan / max cash**: max CLTV × value − 1st lien, checked across every loan tier (a bigger loan can land in a tier with a lower limit), within program loan limits and any cash-out cap, floored to the dollar.
6. **Room left**: max − CLTV, in points and dollars.
7. **Requirements checklist**: each rule → ✓, ✗, or Verify (borrower's value unknown). Verify never blocks.
8. **Eligible** = a matrix cell exists, it fits, and no rule failed.
9. **How to fit**, per failed reason: CLTV over → "lower loan amount to $X (−$Y)"; credit score → "needs N FICO (+gap)", plus "no loan-amount change fixes this" when no tier works at their score; reserves → "needs N months"; doc type / occupancy / state → "no change fixes this".
10. **Closest to eligible**: fewest failed reasons first, then smallest gap as a share of the limit; an unfixable reason counts as a full miss.
11. **Badges**: Best fit (most room left), Highest max loan, Lowest FICO floor. On a tie, the badge goes to a card that doesn't already have one.

### Test cases: Marcus

652 FICO, $467,000 value, $282,000 1st lien, $75,000 closed-end 2nd, cash-out, primary SFR, bank statement 12 months, DTI 36%, 0×30×24, no credit events, self-employed 6 years, reserves not verified, Texas homestead.
LTV (this lien) **16.06%**, CLTV **76.45%**, Texas cap 80%.

| Program (sample data) | Expected |
|---|---|
| Lonestar Equity Flex CES (cell 80%) | Eligible; max CLTV 80%; max cash **$91,600**; room **3.55 pts / $16,600**; reserves = Verify; Best fit |
| Cypress Bank Statement 2nd (cell 85%) | Eligible; capped to 80% by Texas; $91,600; Highest max loan (tie goes to the card without a badge) |
| Northgate Alt-Doc CES (cell 78%) | Eligible; **$82,260**; room 1.55 pts |
| Cypress Prime 2nd (cell 75%) | 1 reason: "Max CLTV 75% at 640–659; scenario is 76.45%". Fix: **lower loan amount to $68,250 (−$6,750)**. Closest fit |
| Northgate Prime CES (680 min at ≤$350K) | 1 reason: needs 680 FICO (+28); no loan-amount change fixes this. Ranked second (4.1% gap vs 1.9%) |
| Bluebonnet HELOC Select | 2 reasons: full doc only (no change fixes this); min FICO 700 (+48) |

Edge cases: CLTV exactly 80.00% fits; $150,000 falls in the ≤$150K tier and $150,001 in the next; no credit score → ask for one before searching; not homestead or not cash-out → no Texas cap; overlapping rows → lower limit wins.

## Components

- **ScenarioBar**: scenario chips, Edit scenario, "Search N programs".
- **ProgramCard**: lender initials, lender and program name, category chips, "Fits matrix" badge, fit badges, 4 **StatTile**s, **RoomBar** ("CLTV 76.45% of 80% max · 3.55% room"; amber when tight), compare checkbox, View program.
- **ProgramDetail**: right-hand panel on desktop, drawer on phone. Header with Matrix PDF, Lender portal, Choose program. Contains:
  - **SegmentedFilter** × 4 (occupancy, property type, product, doc type), pre-set to the scenario.
  - **MatrixGrid**: borrower's credit row and loan column tinted; their cell outlined green with ✓ or red with the gap; overlay notes (Texas §50(a)(6)) underneath.
  - **FitLine**, then **RequirementsChecklist** (✓ / ✗ / Verify).
  - **ProgramDescription**: paragraphs with a **CitationChip** that opens the source PDF at that page.
- **IneligiblePanel**: Hide, filter box, reason count per program, expandable red reasons, "Closest fit" chip, how-to-fit line.
- **CompareBar**: "N selected · names" and "Compare & run scenarios"; shows at 2–4 selected, a 5th is blocked.

Reuse the existing Card, chips and the file header's metric strip. The same cards serve the borrower's Loan section and the Lenders page quick search.
