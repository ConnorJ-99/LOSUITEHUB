# Inbox fully live (two-way SMS + email, HTML emails)

Connor's spec, 2026-11-03. Built in phases, stopping after each one. Test mode stays on until Connor says go.

## Rule #0: nothing sends on its own

The only code that sends a text or email through GHL is the `ghl` Edge Function's `send` task (`sendMessage` in `supabase/functions/ghl/index.ts`). Since Phase 1 it takes only an approval id, and sends exactly what that approval says, once.

- `approve_send()` (database) is the only way to make an approval: the file's loan officer or an admin, for a borrower on that file, one exact message (person, file, text or email, subject, words, attachments). The app can read approvals but can't add, change or delete them.
- `claim_send_approval()` (service role only) uses it once, by the person who approved it, within an hour, and only if they may still approve on that file. Test mode ending cancels unused approvals.
- Every other check still runs on the server first: consent and opt-outs, GHL's Do Not Disturb (live), sending hours, test mode, the LO's confirmed GHL number.

### Every send path and its approval check

| # | Where | What sends | Approval |
|---|---|---|---|
| 1 | Messages tab → reply box (`Composer`) | 1 text or email | Confirm box → `approve_send` → `send` with that approval |
| 2 | "Send…" on a saved PDF (`SendDocumentDialog`: Documents, Scenarios & Estimate, Letters) | the email, plus the optional heads-up text | Confirm box lists both → one approval each |
| 3 | Quick Quote "Email" (`EmailQuoteDialog`) | the email, plus the optional heads-up text | Confirm box lists both → one approval each |
| 4 | Today / Action Queue draft "Send text / Send email" (`ActionEntry`) | 1 text or email | Confirm box → `approve_send` → `send` |
| 5 | Failed send → "Resend" (Messages tab, Inbox "Failed sends") | the same words again | Confirm box → a new approval → `send` |
| 6 | "Schedule…" (reply box, New message, Today drafts) → the every-minute timer | 1 text or email at the chosen time | The Schedule window approves it (`approve_send` with `send_at`); pg_cron `scheduled_ghl_send()` → `ghl` task `send_due` (key + anon key) sends it as the approver, with every check again; one that can't go is cancelled with the reason |

Paths 1–5 go through `useSendMessage` (`src/lib/api/messages.ts`), which approves first and then sends; path 6 approves with `useScheduleMessage` and only the timer sends it. A call to `send` without an approval sends nothing.

### Automations that never send (checked 2026-11-03)

- pg_cron `losuite-ghl-catch-up` every 10 minutes: reads from GHL only.
- `ghl-inbound` (webhook and catch-up): reads from GHL only.
- Website lead intake first-touch, prequal follow-up, reminder and condition drafts: drafts in the Action Queue only.
- The `assistant` function: no GHL calls.

### GHL changes that aren't messages (kept automatic, Connor 2026-11-03)

- Moving a file to Closed moves the borrower's GHL opportunity (`opportunity` task); "Copy to a new lead" and "Update GHL" do the same.
- Sending, and "Send prequal results", can find or create the person's GHL contact and assign it to the LO (no tags, no workflows).

## Step 0 findings (2026-11-03)

- **Test mode:** `messaging_settings.inbound_mode` = `test_only` (default) or `all`. TEST = the capital word TEST in the first or last name. It gates inbound saving (by name, `ghl_linked_at`, no GHL automated sends), sending, opportunity moves and GHL contact creation.
- **Inbound:** "Customer Replied" workflow → `ghl-inbound` (a notice only; the function reads GHL itself), plus the 10-minute catch-up (the 100 newest conversations). Messages are saved once each by GHL message id. Messages sent from the GHL app arrive through the catch-up.
- **Matching:** stored GHL id, then email, then 10-digit phone, never by name; anything unclear goes to the admin-only Needs matching list.
- **Sender:** texts from the file LO's confirmed GHL number only; email from the LO's address when mps.mortgage is verified, else info@mps.mortgage. No company fallback.
- **STOP / do-not-contact:** a whole-message STOP word (stop, stopall, unsubscribe, cancel, end, quit) turns texting off; GHL's Do Not Disturb turns either channel off; only "Restore…" with a note turns it back on.

## Phase 1 (built 2026-11-03; `20261222000000_send_approvals.sql`)

- Approval-only sending (above).
- Failed sends stay visible with the reason, on the thread and in Inbox → "Failed sends", until Resend or Dismiss (`clear_failed_send()`).
- Live updates: `messages` is in Supabase Realtime; open screens reload message lists the moment one is saved (30-second refresh stays as a backup). Each person only hears about messages Row Level Security lets them see: an LO their own files, admins everything.
- Needs matching → "New lead from this": a new lead with the sender's details, and their messages moved onto it.
- Settings → Sending → Test mode switch (owners and admins). Turning it off dismisses pending Action Queue drafts (`action_items.skipped_reason = 'test_mode_ended'`) and cancels unused approvals; nothing is sent. Done by a database trigger, so the SQL Editor does the same.
- Who may approve changed: processors no longer send (they never could approve).

## Phase 2a (built 2026-11-03; `20261223000000_scheduled_sends.sql`)

- **Schedule…** on the reply box, New message and Today's drafts: approve now, send at a Central day and time inside sending hours, up to 60 days ahead. A scheduled draft leaves the queue.
- **Scheduled** card on Today: waiting messages with Cancel (whoever scheduled it, or an admin), and ones from the last 3 days that didn't go, with the reason. Over a day late = missed, never sent.
- The timer needs Vault secret `losuite_anon_key` (the legacy anon key, starting eyJ) besides the catch-up's two.
- **New message** in the Inbox: any client on a file you can see, with the same reply box.
- An email reply whose first line only says unsubscribe / stop / remove me turns email off (`isEmailUnsubscribe`).
- Partners (realtors, title) as recipients are the next step (2a-ii): they need their own threads and inbound matching.

## Phase 2b (built 2026-11-03; no database change)

- **One reply draft per burst.** When `ghl-inbound` saves a new message from a matched client on a file, `draftReply` makes one Action Queue draft ("Reply to Rita") keyed `reply:<person>:<first message of the burst>`. More messages before we answer rewrite that same draft while it's still waiting; once it's sent, scheduled or dismissed, the next burst gets a new one.
- **No draft** for opt-outs (STOP, email unsubscribe), bare "ok / thanks", a channel the client opted out of, or unmatched messages (they wait in Needs matching).
- **AI:** with `ANTHROPIC_API_KEY` in Edge Function secrets, Sonnet 5.5 writes it from the last 12 messages and the file's stage and purpose (`supabase/functions/assistant/replyDraft.ts`), logged in `ai_runs` (task `reply_draft`) and held to the follow-up compliance rules. Without the key, or when the AI's draft can't be used, a template start is drafted and the Today card says to finish it.
- **Never sends.** The draft goes through the same Send / Schedule / Edit / Dismiss on Today as any draft, with an approval each time.
- The "notification" for now is the existing pop-up and Today's New messages box; the bell and phone push are Phase 2c.
