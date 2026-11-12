# AI income calculation (Stage 4)

Status: plan, waiting on Connor (2026-11-12).

## Reused
- Income worksheets (`income_worksheets`, Income tab, `src/lib/income/worksheets.ts`): salary, hourly, variable (OT/bonus/commission with YTD + prior-year averaging, declining = lower current rate, 20%+ drop flagged), Schedule C / 1120S / 1065 (Form 1084 add-backs, two-year rule), bank statement, rental. Line-by-line math (`IncomeResult.lines`, CalcLines) and "Push to 1003" with the "1003 no longer matches" notice.
- Stage 3 upload analysis: each pay stub, W-2, statement and return is already read (fields with quotes). Calculate income uses those readings: no new AI call at click time; the math is code.
- Borrower PDFs (@react-pdf, MPS templates, one page, saved to Documents with kind and template version).

## Not found (the spec calls them existing)
- The bank statement calculator is one total-deposits box, excluded deposits, months, account type, one expense factor (default 50%) and ownership. There is no expense factor matrix and no PDF extraction or deposit-by-deposit analysis yet.

## Plan
1. The reader (Stage 3) learns more fields: pay frequency, base this period, YTD through date; W-2 boxes 1/5; per statement total deposits and the largest deposits (date, amount, description); Schedule C and K-1 lines used by Form 1084. Older uploads: Re-run analysis.
2. `src/lib/income/fromDocuments.ts` (pure, tested): picks each job's latest pay stub and W-2s and fills salary/hourly + variable worksheets; statements → bank statement worksheet (sum of deposits, large deposits listed for Connor to exclude, months, expense factor from the program rule else 50%); returns → the matching self-employed worksheet. Every figure keeps its source document.
3. `income_worksheets` gains `status` (draft / final), `source` (manual / ai) and `source_document_ids`. Drafts never push; Accept = the existing Push to 1003, and makes it final. Never overwrites a worksheet Connor typed: a draft is a new worksheet beside it.
4. "Calculate income" on the Income tab and on an analyzed pay stub, W-2, statement or return. Never automatic.
5. One-page "Income Analysis" PDF per worksheet (MPS template, line-by-line math, sources, warnings), saved to Documents (new kind `income_analysis`).
