# Scenarios & Estimate: data-model plan (Part 1.2)

Status: **waiting for Connor's OK** (CLAUDE.md rule 8). Nothing below is built yet.

## The idea in one paragraph

An **estimate** is one complete option for the file: the deal (price or value, down
payment, closing date, credits, home), one program and lender, its pricing (rate,
points or credit, lock, term), its own Smart Fees sheet with your edits, and notes.
Today's **pricing scenario** (`pricing_scenarios`, the Fees tab) already holds almost
all of that, including its own fee edits (`loan_fees`). So an estimate **is** a pricing
scenario row with a few more columns. No new estimates table. The Loan · Pricing quotes
(`loan_quotes`) fold into it, because each estimate now carries its own program and
its own rate and points.

## What stays exactly as it is

- `pricing_scenarios` stays the table. The screen calls each row an "estimate".
- `loan_fees` stays "your edits to one estimate's fees" (one row per edited or added fee).
- `loans.pricing_scenario_id` already means "the estimate used for this file". It becomes
  **Selected for file**. Only one at a time is automatic (it is one column on the loan).
  Selecting another just points it somewhere else; the old one stays saved as a Draft.
- The loan stays the one source of truth (rule 4). Editing an estimate never touches the
  loan; **Select for this file** writes the loan fields (today's "Use for this loan").
- `loan_program_options` stays the list of programs on the file (the "On this file" list
  in Build estimates).
- Quick Quote keeps calling `priceScenario` unchanged.

## New columns on `pricing_scenarios` (each estimate)

1. **`program_option_id`**: which program and lender this estimate prices (links to the
   file's program list). Blank for an estimate typed by hand, which keeps today's typed
   lender and program names.
2. **`quote_date`**: the date of the lender's pricing ("Priced Nov 3").
3. **`archived_at`**: when it was archived. Archive is soft: blank = active, filled =
   hidden under "Show archived", and Restore clears it. Nothing is deleted.
4. **`seller_credits`** and **`earnest_money`**: this estimate's own figures, so "Change
   for all" can set them and one estimate can try a different credit. Blank = use the
   loan's seller credit and the 1003's earnest money. Selecting writes them back.
5. **`fee_rules`** (saved as one block of data): the fee-list rules that matched when
   Smart Fees last ran. This is what makes an old estimate open with **exactly** the
   numbers it had. Changing a fee in Settings doesn't silently change saved estimates;
   it shows up when you hit Regenerate fees or Refresh with current loan. Editing the
   estimate (rate, loan amount) still recalculates its percent and formula fees right away.
6. **`figures`** (one block of data): the saved results (loan amount, payment lines,
   closing costs, cash to close, funds left, reserves, DTI). Chips, the saved list and
   Compare show these without recalculating, and they are what "Loan changed" compares.
7. **`loan_snapshot`** (one block of data): the loan facts the estimate was priced from
   (price, home, county, closing date, debts, assets). When those change on the file,
   the estimate shows "Loan changed since this estimate: price $385,000 → $395,000".
8. **`priced_at`** and **`fees_generated_at`**: when the math and Smart Fees last ran,
   for "Priced Nov 3 · fees generated Nov 3".
9. **`from_loan_id`**: on a refi or new purchase copied from a closed loan, which loan
   this estimate came from ("From previous loan"). Deleting that loan just clears it.

## Changed rules (constraints, not columns)

- `pricing_scenarios.points_pct` may be **negative** (a lender credit as a percent,
  e.g. −0.135%), like quotes allow today. Positive = points paid.
- `loan_program_options_one_per_program` is **dropped**, so the same program can be on
  the file twice (FHA 30 at 6.250% / 3.5% down and FHA 30 at 6.000% / 1 pt / 5% down).
  Adding from Product Search still brings back a removed program instead of a copy.
- `fee_templates_key_unique` is **replaced**: the same fee can have several rules
  ("Underwriting fee" for UWM, another for Rocket, a default). Smart Fees picks one per
  fee: lender + county > lender > county > state > default.

## Smart Fees (Part 4) columns on the company fee list (`fee_templates`)

An "Applies when" row per fee:

- **`states`**, **`counties`**: only for homes in these states or counties.
- **`lender_id`**: only for this lender (so lender charges differ per estimate).
- **`min_loan_amount`**, **`max_loan_amount`**: only inside this loan-amount range.
- **`occupancies`**: primary, second home, investment.
- Purpose and loan type already exist (`purposes`, `mortgage_types`; non-QM/DSCR uses "Other").
- Two new amount types: **tiered** (a bracket table, stored in **`tiers`**) and **formula**
  (a named calculator in code, stored in **`formula`**: Texas owner's title, Texas
  lender's title, UFMIP, VA funding fee, USDA guarantee, recording by county, prepaid
  interest, escrow reserves).

Two more small columns:

- **`lenders.mortgagee_clause`**: the lender's mortgagee clause, shown on the estimate.
- **`organizations.default_hoi_pct`**: Settings default for homeowner's insurance as a
  percent of value, used when the home has no insurance figure.

Rates that change by law (TDI title premiums, FHA MIP, VA funding fee, USDA fees) live in
one constants file in code, each with its source and "verified on" date, looked up online
before entering. No table for them.

## Not stored on the estimate (one place only)

- **Debts paid at closing** stay the 1003's "paid off at closing" toggle on each debt.
  The toggle in the estimate's Cash to close card changes the 1003, so every estimate
  follows. (It's an application fact, like assets.)
- **Available funds** come from the 1003 assets (checking, gifts, etc.).
- Down payment is price − loan amount; it isn't saved separately.

## Retired (marked deprecated, NOT dropped; I'll ask before dropping anything)

- **`loan_quotes`**: the script turns each saved quote into its own estimate (a copy of
  its scenario with the quote's program, rate, points, lock and date), so nothing is
  lost. If a quote was chosen, its estimate becomes Selected for file. The table stays
  but nothing writes to it.
- **`loans.chosen_quote_id`**: replaced by `loans.pricing_scenario_id`. Kept, unused.
- **`pricing_scenarios.lender_name` / `program_name`**: still used for typed estimates
  and as the saved label; no change.

## Order of work (one commit per part)

1. One workspace: nav item, layout, step rail, one cash-to-close function; 1003,
   Overview, Prequal and the file header read the selected estimate.
2. Build estimates, the same program twice, Change for all, Duplicate, Compare.
3. Autosave, saved list, snapshot banner, Select for this file, "Update the file too?",
   closed files and carry-over.
4. Smart Fees: rules, tiered/formula, TX title, government fees, reserves by tax due date.
5. Cleanup, tests, screenshots.

The database script for parts 1–3 is one file (`20261217000000_estimates.sql`); Smart
Fees is a second (`20261218000000_smart_fees.sql`). Both are re-runnable, tested in
PGlite, and end with a confirmation row.
