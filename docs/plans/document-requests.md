# UI pass Part 3 plan: custom document requests

Approved by Connor 2026-11-11 ("Yes, build it"): upload links may go in draft texts (a second exception after shared estimates), and the Pages "Upload your documents" template stays as it is.

## What's there today

* **`document_requests`:** the Documents tab checklist. Each row is one item for one person: label, document type, status (requested, received, reviewed, waived) and the matched upload. Phase 8's suggested conditions read it, and a database trigger moves a linked condition to Received when its item comes in.
* **`document_rules`:** the Settings checklist rules. These decide what's suggested automatically.
* **The "Upload your documents" page:** a **Pages** form template with three fixed file boxes. It isn't tied to a file.
* **No classification step** for uploads (Documents 7c was never built).
* **Shared estimates (Phase 7)** already has the pieces a borrower link needs: a token link, the email check (5 wrong in an hour lock it), a 24-hour session, the LO card and a one-minute signed file link.

## The plan: build on these, no second system

**Items:** the existing `document_requests` rows *are* the request items, extended rather than copied:
* new columns:
  * `instructions`: what the borrower sees;
  * `catalog_key`;
  * `condition_id`: an optional linked condition;
  * `link_id`: the upload link it went out on;
  * `due_on`;
  * `reject_reason`;
* status words map like this:

  | Your word | Status on file |
  |---|---|
  | requested | requested |
  | uploaded | received |
  | accepted | reviewed |
  | rejected | rejected (new) |

  Waived stays as it is.

So the Phase 8 sync keeps working, and the same item never shows twice.

**New tables** (one script, safe to re-run, ends with a confirmation row, tested in PGlite):

| Table | What it holds |
|---|---|
| `document_catalog` | One per company, editable in Settings → Document catalog. Each item has: category (Income, Assets, Credit & identity, Property, Other), label, borrower instructions, default period, document type, order, on/off. Seeded with your list. Where an item matches a checklist rule (pay stubs, W-2s, bank statements…) it uses the rule's key, so a request and a suggestion are recognized as the same thing. |
| `document_upload_links` | One link per borrower per send: file, borrower, the 64-character token (stored hashed), expiry (14 days by default), status, due date, who made it, when it was sent, the email-check session (hashed), and wrong-email tries. |
| `document_request_presets` | Name plus a list of items (catalog keys or typed items with instructions). Examples: "W-2 starter", "Self-employed", "Purchase contract docs". Shared across the company; owners, admins and LOs make them. |

**Uploads:**
* Each upload lands in `loan_documents` (the Documents tab) with a new `document_request_id`, so one item can have several files.
* Files go in the private `loan-files` bucket like every other upload.
* RLS: the file rule, the same as everything else (an LO sees only their own files).

## Screens

* **"Request documents" builder** (a side panel). It opens from:
  * Documents → Request documents;
  * Conditions → "Request docs" on a condition (its items are pre-linked to that condition);
  * a quick action in the loan header.

  In the builder you can:
  * search and tick catalog items, and type your own;
  * edit each item's instructions;
  * link an item to a condition;
  * set a due date;
  * pick the borrower (co-borrowers get their own link);
  * apply a preset, or save the ticked items as a new one.
* **Send** saves the items, makes the link, and puts a **draft text and email with the link** in the Action Queue. Nothing sends until you press Send, Edit, Schedule or Dismiss there.
* **Borrower page `/u/{link}`:** your MPS branding and LO card.
  * They confirm their email first, the same check as shared estimates.
  * Then they see only the requested items, with your instructions.
  * Each item takes PDFs or photos up to 10 MB, several files per item, using the phone camera.
  * Each item shows "Received ✓" or "Needs attention: {reason}".
  * Expired links show "Contact {LO}".
  * It runs through a new Edge Function, `document-upload` (Verify JWT off), like the estimate page.
* **Documents tab → Requests view:**
  * Each item with its status and files; **Accept** or **Reject with a reason**. Rejecting puts the item back on the borrower's page.
  * When every item linked to a condition is accepted, you get "Mark condition cleared?" (never automatic).
* **Overdue reminders:** when Today opens, a reminder text or email draft is made for a link with items past due, at most every 3 days. Drafts only.

## Two things to confirm

1. **Links in texts.** The standing rule is that texts never carry links; shared estimates were your one exception. This adds **upload links** as a second exception, in drafts you approve. OK?
2. **The old Pages "Upload your documents" template** stays as it is, for people not on a file yet. The new link is for borrowers on a file. OK?

## Not in this part

* **Auto-classifying uploads:** there's no classification pipeline yet (Documents 7c). Uploads are tagged by the item they were sent for.
* **AI reading of uploads.**

## Build order and shipping

1. Script plus catalog and presets.
2. The builder and the drafts.
3. The borrower page and the Edge Function.
4. Review: Accept / Reject and the condition prompt.
5. Reminders.

Each step is tested. Then your click-through: 3 catalog items plus 1 typed, one linked to a condition, the draft text, upload from your phone, reject one, and see it come back on the page. One commit after your OK.
