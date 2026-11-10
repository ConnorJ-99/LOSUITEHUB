# Phase 0b plan: lender product updates pasted from email

Approved by Connor 2026-11-10 ("Yes, build it"), including the new `product_updates` table.

## What you'll do

1. **Lenders page → "Paste a product update"** (owners and admins). Paste the email text (subject line too, if you like) and the date you got it. Press Read.
2. MPS-HQ opens the update on its own screen:
   * **Left:** the email as you pasted it.
   * **Right:** which lender and program(s) it's about, and each proposed change next to what's on file today, with the exact sentence from the email it came from. For example:
     * "Newfi Sequoia DSCR · Max DTI: 50% → 55%" with the quote "max DTI increased to 55%" ✓ found word for word
     * "Primary · Purchase · 700+ · up to $1,000,000: Max LTV 80% → 75%"
     * "States: add Florida"
     * "Guideline text only (no limit changes): saved as guideline text"
   * Each change has a checkbox. You can change the lender or programs it picked.
3. **Confirm.** For each program with a limit or rule change, MPS-HQ makes a draft on the usual matrix review screen (the "Edit limits" draft you already use), with only the changes you ticked. That screen shows what changes against the version in use. **Approve** there makes a new matrix version, like every other matrix. The old version is kept as superseded and is never overwritten.
4. **Discard** if it's nothing (a marketing email, a rate sheet).

**With the AI key off**, it still works: paste the email, pick the lender and program(s) yourself, and "Edit limits" opens the same draft with the email shown above it for you to type the changes.

## Where the email is kept

* Every paste is saved the moment you press Read, so nothing is lost if the page closes. Its status is Waiting for review, Confirmed or Discarded.
* On Confirm, the email is saved as one of the lender's guideline documents, with type **Bulletin** (the type already exists) and no PDF file. Its text becomes searchable guideline passages, so Product Search's guideline questions and the assistant can quote it later. Pasting the same email twice is caught.
* **An update that only changes guideline text** (no limits) stops there: it's saved as that bulletin and linked to the programs. No new matrix version.
* Changed limits and rules cite the email and its quote. Unchanged ones keep citing the matrix PDF they came from. This needs a small change to `approve_matrix_import` so each cell or rule can name its own source document. Today every cell in a new version is stamped with one document.
* The lender's detail view gets a **Product updates** list: date, subject, programs, status.

## The AI part

A new assistant task, `product_update_read` (Opus 5.5, logged in `ai_runs`), gets the email plus the lender's programs and what each has on file now. It returns the lender, the programs, and the changes, each with its exact quote. Code checks every quote word for word against what you pasted. A change whose quote isn't found is dropped and listed as "left out, check the email." The AI never approves anything. The changes are applied to the program's current matrix in code, with tests (`src/lib/products/productUpdate.ts`). The lender is guessed from names in the email first, so a mismatched lender is easy to spot.

The `assistant` function will need a redeploy after this is built (`npm run function:paste`). I'll give you the file when it's ready.

## Database (one script, safe to re-run)

* **New table `product_updates`: needs your OK.** One row per paste: lender, the pasted text, subject, received date, status, programs, the drafts it made, the saved bulletin, and the AI run. Everyone in the company can see them. Owners and admins add and decide them. Nothing is ever deleted, so you keep the record of what the lender sent and what you did with it.
  * Why a table: before you confirm, the email has to live somewhere, and none of the existing tables fit. A guideline document would make it searchable before you've checked it. A matrix draft only covers one program and has nowhere to keep guideline-only updates.
* `matrix_imports` gets a link back to its update (`product_update_id`, nullable).
* `approve_matrix_import`: each cell or rule may carry its own source document. When it doesn't, it falls back to the import's document, exactly as today.

## Not in Phase 0b

* Reading attachments (PDF matrices still go through Upload document).
* Forwarding emails into MPS-HQ automatically. You copy and paste.
* Holding a change until its effective date. Approving makes it live right away, as today, so wait to approve if a change starts later. The effective date in the email is filled in on the new version.

## Also checking

Before testing, I'll look for the interrupted Newfi Sequoia DSCR re-read (a waiting reading for Newfi) so we don't read it twice.

## Tests

* Quote checking: exact match, case and extra spaces, curly quotes, and a quote that isn't there.
* Applying changes: a rule changed, added and removed; one matrix square changed; a state added; nothing else in the matrix moves.
* Lender guess from the email text.
* Guideline-only updates make no draft.
* Database script in PGlite: run twice, then a partial run followed by a full run. The approve function keeps the old citations when no per-item source is given.
