# Loan Officer Assistant

Connor's spec, 2026-11-03: a chat assistant inside every borrower file and on its own page, by typing or voice, that runs the same actions the app's buttons run. It never sends anything to a borrower or client without a tap on Send. Built in three phases, stopping after each one.

## Decisions (Connor, 2026-11-03)

1. The Anthropic key goes in Edge Function secrets (`ANTHROPIC_API_KEY`); with no key the chat says "API key not set".
2. GHL opportunities move on Closed only (as today); no other stage syncs.
3. Estimates go by email with the PDF, plus a short heads-up text with no link. Never PDFs or links in texts.
4. Bulk texts (last in Phase 3): only people who already have a GHL contact AND recorded text consent; no GHL contacts created in bulk; batches of 20 a minute; a daily cap of 250, changeable in Settings; the preview shows how many were left out and why (no consent, no GHL contact, opted out). Connor confirms his A2P campaign allows marketing before using it.
5. New tables `assistant_actions` and `assistant_chat_messages`.
6. Inside the assistant they're "Fee Estimates" (or "Payment Scenarios"), never "Loan Estimate"; the file tab stays "Scenarios & Estimate".

## How it works

- **`assistant-chat` Edge Function** (Verify JWT on) only talks to Claude: it adds who's asking, today, the lenders and programs, and the rules (`supabase/functions/assistant-chat/tools.ts`), and returns Claude's answer. The model is `ASSISTANT_MODEL` (an optional secret) or `claude-sonnet-5-5`. Every call is logged in `ai_runs` (task `assistant_chat`). Nothing is changed or sent there.
- **Tools run in the browser** as the signed-in person, with the app's own code (`src/lib/assistant/`), so the database's access rules decide every result: a loan officer only reaches their own files. Each run is logged in `assistant_actions`.
- **Chats** are saved per person: one thread per file and one general thread (`assistant_chat_messages`, with the cards shown).

## Where it lives

- **Computer:** a slim "Assistant" tab on the right edge of every file opens a 400px panel that pushes the page over (nothing is covered).
- **Phone:** a sparkle button in the top bar (only inside a file) opens a near-full-screen sheet; swipe the handle down or tap ✕ to close; it sizes itself to the screen above the keyboard.
- **Assistant page** (`/assistant`, in the sidebar and the phone menu) for questions across all files.
- **Voice:** the browser's speech-to-text (Chrome, Edge, Safari); the words show in the box first; "Send when I stop talking" sends on its own. Elsewhere, the keyboard's own dictation.

## Phase 1 (2026-11-03; `20261225000000_lo_assistant.sql`): read tools

| Tool | Reuses |
|---|---|
| `find_borrower` | `fetchContacts` (the Contacts list) + `borrowerMatches` |
| `get_borrower_summary` | `fetchLoanProfile`, `fetchProperties`, `fetchConditions`, `fetchNotes`, `fetchEstimates`, the file's consent and latest messages |
| `list_borrowers` | `fetchPipeline` + `filterBorrowers` (stage, purpose, closing dates, lender, days since we last texted, emailed, called or noted) |
| `list_estimates` | `fetchEstimates` |

Cards: borrower lists (tap to open), a file summary (Open), Fee Estimates (Open → Scenarios & Estimate), and choice chips when more than one person matches.

## Phase 2 (2026-11-04; no database change): in-app changes with Undo

Each change runs right away with the app's own code, saves what it needs to put things back in `assistant_actions.undo`, and shows a card (before → after) with **Undo** and next-step chips. Nothing reaches a client.

| Tool | Reuses | Undo |
|---|---|---|
| `create_fee_estimates` | Build estimates: `newProgramOption`, `draftFromRow`, the Estimate tool's create (`estimateDataFrom` / `loadEstimateData`: `withResults` + `createEstimate`). Programs are matched by lender + program words (`matchProgram`: an exact name wins, else it asks). All or nothing. | deletes them (kept if one was Selected since) |
| `update_estimate` | the Estimate tool's save (re-priced) | puts the old values back |
| `set_selected_program` | `selectEstimate` ("Select for this file") | restores the loan fields and the home's taxes, insurance and HOA, and removes the "Selected …" note |
| `move_pipeline_stage` | `updateStage`, plus the GHL move on Closed only. Lost needs a reason; Closed needs the email and phone. | old stage, Lost reason and status detail (GHL isn't moved back) |
| `update_borrower_fields` | `saveProperty` (`blankPropertyInput`) and `saveLoanDetails`: subject property, purchase price, closing date | old values; a home it added is removed |
| `add_note`, `create_task` | the same inserts as the Notes and Tasks screens | deleted |

To share that code, the screens' loaders became named functions they still call (`fetchFeeTemplates`, `fetchApplication`, `fetchLoanFees`, `fetchProgramList`, `saveProperty`, `updateStage`, `estimateDataFrom`, `selectEstimate`); the screens behave the same.

Checked on Rita TEST (2026-11-04): three Pennymac Conventional Fee Estimates at 6, 6.5 and 7% on a $400,000 home with 20% down and 1.5% taxes came out at P&I $1,919, $2,023 and $2,129 with $500 taxes, matching the mockup. Update, Select, Under Contract, a note and a task all worked, and undoing each one left the file exactly as before.

## Phase 3 (after): sending
Message drafts → a preview card; Send goes through the approval send path. Bulk last, as decided above.
