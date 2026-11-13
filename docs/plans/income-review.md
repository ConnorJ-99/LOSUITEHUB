# Income Review: every figure traced to its document (Stage 4d)

Status: plan, approved by Connor 2026-11-13. Build in the order below, one part at a time: 4d-1, then 4d-2, then 4d-3. Test, click through and commit after each part (CLAUDE.md rule 7). The `income_worksheet_edits` table was approved by Connor on 2026-11-13 (rule 8).

## Why

"Calculate income" (Stage 4) already makes AI draft worksheets from the analyzed uploads, and Accept already pushes them to the 1003. What's missing is proof. A draft knows which documents it used, but not which figure came from which line on which page. There is no record of what Connor changed, either. An auditor or underwriter should be able to open any worksheet and see, for every number, where it came from and who checked it.

## Already built (reuse, don't rebuild)

- `document_analyses.fields`: every read field has `{ value, quote }` (`supabase/functions/assistant/documentRead.ts`).
- `src/lib/income/fromDocuments.ts`: stub/W-2 → salary/hourly and variable drafts. It compares the stated rate with the YTD average and uses the lower one, and adds a note comparing this year's pace with the latest W-2.
- `income_worksheets.status/source/source_document_ids/source_notes`, with Accept = Push to 1003 (trigger).
- `WorksheetCard.tsx` (AI draft banner + notes), `IncomeAnalysisPdf.tsx`, `src/lib/documents/pdfText.ts` (pdfjs-dist is already installed), `documents.ts` signed URLs.

## Not in scope

A program selector (Fannie/Freddie/FHA/VA/USDA/Non-QM rule sets), deposit-by-deposit bank statement analysis, and a tax return review screen. Those are later stages. Nothing here runs automatically, and the AI still never does the math.

## 4d-1: Record where each figure came from

1. **Reader records the page.** `ReadField` gains an optional `page` (1-based page of the PDF the quote is on; 1 for a photo). Update the `document_read` prompt and schema. No migration is needed (it's jsonb). Older analyses have no page; Re-run analysis fills it in.
2. **Drafts keep a source for each input.** Add `income_worksheets.input_sources jsonb not null default '{}'` (object check, like `inputs`). Keys are the input name inside `inputs` (`amount`, `ytdAmount`, `ytdMonths`…). Each value is `{ "documentId": uuid, "field": "base_pay_current", "value": 2400, "quote": "Regular 80.00 30.00 2,400.00", "page": 1 }`. Derived inputs (e.g. `ytdMonths` worked out from the pay date) point at the field they came from (`pay_date`) and add `"derived": "months through Oct 14"`. `fromDocuments.ts` returns `inputSources` on every `IncomeDraft`. It stays pure and tested: cases in `fromDocuments.test.ts` for a salary stub, an hourly stub, the YTD-lower case, and a variable draft. Manual worksheets keep `{}`.
3. **Log every change to an AI figure.** New table `income_worksheet_edits`: `id, organization_id, worksheet_id → income_worksheets on delete cascade, input text, ai_value numeric, ai_quote text, new_value numeric, changed_by → profiles on delete set null, changed_at default now()`. Insert-only (no update/delete for `authenticated`), RLS through `can_see_loan` on the worksheet's loan. On save of an `ai` worksheet, a pure function `src/lib/income/edits.ts` (`aiEdits(inputSources, oldInputs, newInputs)`, tested) lists each input whose value now differs from the last saved value and from the AI's value, and those rows are inserted with the save. The migration is safe to re-run and ends with a confirmation row ("MPS HQ income review installed").

Click-through: run Calculate income on a TEST borrower with a pay stub and a W-2. The draft's `input_sources` is filled, editing the base pay adds one edit row, and a manual worksheet is unchanged.

## 4d-2: Review side by side

1. **Source chip on each AI figure.** In `WorksheetForms.tsx`, any input with a source shows a small "📄 p.1" chip under the box. Hovering or tapping it shows the quote. If Connor changed the value, the chip reads "AI read $2,400.00, you changed it".
2. **Review with source.** An AI draft gets a "Review with source" button that opens a full-screen review:
   - Computer: the PDF on the left and the worksheet on the right (the same WorksheetCard, not a copy).
   - Phone: two tabs, Document and Worksheet. Nothing covers the Accept button.
   - The viewer uses pdfjs-dist with a text layer (reuse the loader in `pdfText.ts`) and a signed URL from `documents.ts`. Clicking a chip opens that figure's document, jumps to its page and highlights the quote. Matching ignores case, extra spaces, `$` and commas, and is done by a pure, tested function `src/lib/documents/findQuote.ts` that takes the page's text items and returns the item ranges.
   - When the quote isn't found, or it's a scan or photo with no text layer: show the page and a yellow bar saying "Couldn't point to it on this page. The AI read: '…'".
   - For a draft that used several documents, a document switcher sits above the viewer.
3. **Checked boxes.** Every AI-filled input gets a "Checked" tick, kept on the worksheet as `input_sources[key].checkedBy/checkedAt`. Accept stays disabled until every AI figure is checked or changed, with the hint "3 of 5 figures checked". Changing a figure counts as checking it.

Click-through: open the TEST draft, click the base pay chip and confirm the stub opens on the right page with the line highlighted. Try a phone-sized window. Try a photo upload (yellow bar). Accept stays blocked until everything is ticked.

## 4d-3: Catch documents that disagree, and show it all on the PDF

1. `src/lib/income/reconcile.ts` (pure, tested) runs per job across that job's stubs and W-2s and returns warnings with the numbers in them:
   - This year's pace (YTD gross ÷ months × 12) is more than 5% below the latest W-2 box 1. Move the existing note here and make it a warning.
   - The stated base, annualized, is 20% or more above the latest W-2. Likely a raise or new pay rate: get a WVOE or offer letter.
   - The employer name on the stub doesn't match the W-2 (same `matchJob` matching).
   - A W-2 year is missing: the job started before last year, but only one W-2 has been analyzed.
   - The pay stub is more than 30 days old on the day of calculation.
   - W-2 box 1 is more than 10% below box 5. Pre-tax deductions explain small gaps; a big gap is worth a look before using box 1.

   Thresholds in one constant block at the top. Warnings show on the worksheet (with the calc warnings) and in the review screen, and never block Accept.
2. **Income Analysis PDF** (`incomeAnalysis.ts` + `IncomeAnalysisPdf.tsx`, template `income-analysis v2`) adds a Sources table (figure, document, page, quote cut to about 60 characters), "Changed by the loan officer: AI value → new value", and "Reviewed by {name} on {date}". Still one page under the shrink rule; if it won't fit, drop the quotes column first.

Click-through: a TEST borrower with a stub whose pace is below last year's W-2 shows the warning on the worksheet and the PDF. Save the PDF to Documents and confirm it's still one page.

## Rules that still apply

Test on TEST-named records only (live `tlsq` project). No math in components. Every new relationship has a real foreign key. A draft never pushes on its own, and Accept is always Connor's click.
