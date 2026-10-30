# GHL messaging: Phase 0 report and plan

Oct 29, 2026 · for Connor. This is the follow-up plan's Phase 3 (GHL connection), moved up. **Phase 0 only: check, report and plan.** Nothing has been deployed, sent or changed in GHL, and nothing is committed.

Sources: HighLevel API v2's own OpenAPI files and docs (github.com/GoHighLevel/highlevel-api-docs, commit `0af86a4`, updated 2026-06-19; the same content as marketplace.gohighlevel.com/docs), plus the HighLevel help pages linked below. Endpoint, `Version` header and scope for each call are quoted from those files.

---

## 1. Token check

### What I built (not deployed)

A small Edge Function called `ghl` (`supabase/functions/ghl/`):

- `checks.ts`: the list of checks and how each GHL answer is read. Plain code, with 10 tests in `checks.test.ts` (all pass).
- `index.ts`: runs the checks.
- The paste file is built: `supabase/.paste/ghl.ts` (git-ignored, from `npm run function:paste -- ghl`).

What it does:

- Only a signed-in **owner or admin** can run it. Anyone else gets "Only an owner or admin can check the GHL connection."
- It reads `GHL_PRIVATE_TOKEN` and `GHL_LOCATION_ID` from Edge Function secrets. The token never goes to the browser and is never logged or returned. (The function has no logging at all.)
- It returns the sub-account name and time zone; GHL users (name, email, id, phone, the GHL number assigned to them); the sub-account's phone numbers (which one is the default and which user each is assigned to); and, for every check, "works", "missing scope" or "failed", plus the list of scopes to add.
- **Nothing in GHL is created, changed or sent, and no workflow is touched.** The two "write" checks send a deliberately blank request:
  - contacts write: an empty update to a contact id that doesn't exist;
  - messages write: a message with only a type, with no contact and no text, so there is no one to send it to.

  GHL checks permission before it looks at the request, so "not allowed" means the scope is missing. "Bad request" or "not found" means the scope is there. That ordering is how GHL's API framework behaves, but GHL doesn't document it. If the dry run is ever unclear, the report says "failed" with GHL's own words, never "works".
- The contacts read check looks up `token-check@example.com`, so no real person's data comes back. Conversation and message contents are read (one of each) only to prove access. They are not kept or returned.

| Check | Call | Version | Scope |
|---|---|---|---|
| Sub-account name | `GET /locations/{locationId}` | 2021-07-28 | `locations.readonly` |
| GHL users | `GET /users/search?companyId&locationId` (fallback: `GET /users/?locationId`, marked deprecated) | 2021-07-28 | `users.readonly` |
| Phone numbers and who has each | `GET /phone-system/numbers/location/{locationId}` | 2021-07-28 | `phonenumbers.read` |
| Contacts read | `GET /contacts/search/duplicate?locationId&email` | 2021-07-28 | `contacts.readonly` |
| Contacts write (blank test) | `PUT /contacts/{contactId}` | 2021-07-28 | `contacts.write` |
| Conversations read | `GET /conversations/search?locationId&limit=1` | 2021-04-15 | `conversations.readonly` |
| Messages read | `GET /conversations/{conversationId}/messages?limit=1` | 2021-04-15 | `conversations/message.readonly` |
| Messages write (blank test) | `POST /conversations/messages` | 2021-04-15 | `conversations/message.write` |

Doc pages: apps/locations.json, apps/users.json, apps/phone-system.json, apps/contacts.json, apps/conversations.json, docs/oauth/Scopes.md. Note that conversations use Version **2021-04-15**, while everything else uses 2021-07-28.

### What it returned (dev, Oct 29, 2026, run as the owner)

The deployed code is byte-for-byte the paste file, and Verify JWT is on. The token was accepted.

| Check | Result |
|---|---|
| Sub-account name | **Missing scope `locations.readonly`**, so no name came back |
| GHL users | Works (through the older `GET /users/` call, because the newer search needs the company id from the location call) |
| Phone numbers | Works |
| Contacts read | Works |
| Contacts write (blank test) | Allowed (GHL answered 400 to the blank update) |
| Conversations read | Works |
| Messages read | Works |
| Messages write (blank test) | Allowed (GHL answered 404 to a message with no contact; nothing was sent) |

GHL users: four. Two are loan officers, each with their own GHL number. The other two have no number and don't use LOSuite. (Names, emails and numbers are kept out of this public repo; Settings → GoHighLevel shows them.)

Phone numbers in the sub-account: only two, both local. One is assigned to each loan officer, and Connor's is the sub-account's **default**. There's no separate main MPS number. That's fine, because files without a linked LO are reviewed rather than sent (question 10).

Later the same day `locations.readonly` was added, so all 8 checks work.

info@mps.mortgage is not a GHL user. That's fine for email, because the From address doesn't have to belong to a user.

Small fix after the run: a user with no number showed an empty value instead of "none". This is fixed in `checks.ts`; the deployed copy picks it up on the next redeploy.

### Scopes to turn on for the Private Integration

I can't see which scopes the token has until the check runs. These are the ones the whole build needs. In GHL, open the MPS sub-account → **Settings → Private Integrations**, open the integration and tick:

- `locations.readonly`
- `users.readonly`
- `phonenumbers.read` (lets LOSuite confirm each LO's number really is assigned to them)
- `contacts.readonly` and `contacts.write`
- `conversations.readonly` and `conversations.write` (write is needed later to mark threads read)
- `conversations/message.readonly` and `conversations/message.write`

Changing scopes does **not** change the token, so the secret stays as it is. GHL recommends rotating the token every 90 days. Rotating gives you a 7-day overlap where both tokens work, so you can paste the new one into the secret without downtime ([Private Integrations doc](https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken.md)).

### To run it (after your OK)

1. Supabase **dev** project (the one whose address starts with `tlsq`) → **Edge Functions → Secrets**: add `GHL_PRIVATE_TOKEN` and `GHL_LOCATION_ID` yourself. Never paste them in chat.
2. **Edge Functions → Deploy a new function**, named `ghl`. Paste the whole of `supabase/.paste/ghl.ts`. Keep **Verify JWT on**.
3. I run the check from the dev app while you're signed in as an owner or admin, then report exactly what came back (never the token).

---

## 2. Inbound replies: can the token receive webhooks?

**Short answer: not according to GHL's docs. A sub-account Private Integration Token can call the API, but it can't register a webhook address.**

- GHL's API FAQ says webhook events come to a **Marketplace app**: you register the app, set its webhook URL, and install it on the location (docs/oauth/Faqs.md).
- GHL's own Private Integrations changelog lists "Ability to subscribe to Webhook events in Private Integrations" under **What's next**, not as shipped ([changelog](https://ideas.gohighlevel.com/changelog/private-integrations-for-sub-accounts)).
- A request on GHL's ideas board dated Oct 4, 2026 says sub-account tokens still can't register a webhook URL and points people to a workflow webhook instead ([post](https://ideas.gohighlevel.com/apis/p/let-private-integration-tokens-subscribe-to-custom-object-and-association-webhoo)).
- A private Marketplace app could get real `InboundMessage` / `OutboundMessage` / `ContactDndUpdate` events. It needs OAuth, a developer account and token refreshes, so it's much more setup. I suggest keeping it as a later upgrade.

### The fallback (recommended)

**A. One GHL workflow you build by hand.** It only tells LOSuite "this contact just replied, go look."

1. In GHL, open the MPS sub-account → **Automation → Workflows → + Create Workflow → Start from scratch**.
2. Name it **"LOSuite – reply alert"**.
3. Click **Add New Trigger** → choose **Customer Replied**. Leave the reply channel as any channel, or add two filters for SMS and Email. Save the trigger.
4. Click **+** under the trigger → **Send Data → Webhook**. This is the plain Webhook action (Connor's choice, no per-run charge), not "Custom Webhook".
   - Method: **POST**
   - URL: the `ghl-inbound` address I give you in Phase 2, ending in `?key=` followed by the shared secret. You'll set the same value as `GHL_WEBHOOK_SECRET` in Supabase secrets yourself; I never see it.
   - Leave the rest as it is. GHL sends the contact's details, including the contact id, by itself.
5. Leave **Allow re-entry** on (Settings tab), so every reply fires it, not just the first.
6. Click **Save**, then switch the workflow from Draft to **Publish**.
7. Send a test text to your own GHL number from your personal phone, using a TEST contact, and check the workflow's **Execution Logs**.

**How LOSuite treats the webhook (decision 9):**
- It's only a notice. `ghl-inbound` first checks the `key` (a wrong key is refused, using the same safe comparison as lead intake).
- It never saves anything from the webhook's own text. It takes the contact id (and the message id, if the payload carries one) and fetches the message from the GHL API itself: `GET /conversations/messages/{id}` (Version 2021-04-15, `conversations/message.readonly`) when it has the message id, otherwise the contact's latest messages.
- Only what the API returns is matched and saved, keyed by GHL's message id. A fake or tampered webhook can, at most, make LOSuite check GHL for nothing.
- The secret in the URL appears in GHL's execution logs. Rotate it if the logs are ever shared.
- Your existing workflows stay exactly as they are. This one only adds a ping.

**B. A scheduled catch-up every 10 minutes.** If GHL drops a ping, LOSuite still finds the message. It asks GHL for conversations with new messages since the last check, using `GET /conversations/search` sorted by `last_message_date`, Version 2021-04-15. Messages are saved by GHL's message id, so a reply that arrives by both routes is saved once.

---

## 3. Sending identity

### How a specific sender is chosen (docs)

`POST /conversations/messages` (Version 2021-04-15, scope `conversations/message.write`, apps/conversations.json) takes:

- `type` (`SMS` or `Email`) and `contactId` (the GHL contact)
- `message` for a text; `subject` plus `html` for an email
- **`fromNumber`**: "Phone number used as the sender number for outbound messages"
- **`emailFrom`**: "Email address to send from"
- `toNumber` / `emailTo`, when it shouldn't go to the contact's main phone or email

GHL answers with `conversationId`, `messageId` and a `status` (delivered, failed, pending or read).

So the sender works like this (Connor, Oct 29): `fromNumber` is the assigned LO's own GHL number. `emailFrom` is the LO's own email when mps.mortgage is verified as a sending domain in GHL, otherwise info@mps.mortgage. **There's no company-number fallback.** A file with no assigned LO, or whose LO isn't linked to a confirmed GHL number, is held for review instead of being sent.

### What could block that

1. **A2P 10DLC registration (texts).** US carriers block texts from local numbers that aren't registered to an approved A2P brand and campaign. It's done in the sub-account's **Trust Center** (under Settings → Phone Numbers / Phone System; the menu name moves around) with MPS's legal name and EIN, and each LO's number has to be on the registered campaign. Please check that every number is shown as registered there. ([LC Phone Trust Center](https://gohighlevelassist.freshdesk.com/support/solutions/articles/48001225526-lc-phone-system-trust-center))
2. **A number that isn't assigned to the LO.** The token check lists each number with `linkedUser` (who it's assigned to) and `isDefaultNumber`. LOSuite will only use an LO's number if GHL shows it assigned to that LO's GHL user; otherwise the send is held for review. The docs don't say what GHL does with a `fromNumber` the sub-account doesn't own, so LOSuite will never send one.
3. **The email sending domain (email).** With LC Email and a verified dedicated sending domain, the From address has to be on that domain (`@mps.mortgage`), or GHL blocks the send or swaps in a default address. On GHL's shared domain, GHL rewrites the From address. Please check **Settings → Email Services → Dedicated Domain** shows mps.mortgage as verified. ([Dedicated sending domains](https://help.gohighlevel.com/support/solutions/articles/48001226115), [How sender domains work](https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000007249-how-sender-domains-work-in-lc-email-campaigns))
4. **DND in GHL.** GHL keeps its own Do Not Disturb per channel (`dndSettings.SMS.status` = active / inactive / permanent). LOSuite will check it before every send and treat active as an opt-out.

---

## 4. Plan for Phases 1–4

Each phase is tested, shown to you, and committed separately. Every database script is safe to re-run, ends with a confirmation row, and is tested in PGlite (run twice, then a partial run followed by a full run).

### Phase 1: Connection, people and matching (no messages yet)

- **Settings → GoHighLevel card:** connected or not set up, the sub-account name, last check, and a **Check connection** button that runs the token check. A table of GHL users and numbers, where an owner or admin links each LOSuite team member to their GHL user. The card shows each linked number and whether GHL has it assigned to that user.
  - Only LOSuite team members are linked. The two GHL users who don't use LOSuite aren't linked (Connor, Oct 29).
  - Each new loan officer gets their own GHL number (Connor, Oct 29). Adding one means: create their GHL user and number in GHL, add their login in Settings → Team, link them on this card, then **Check connection** confirms GHL shows the number as theirs.
- `useGhlStatus()`, built like `useAiStatus`. If GHL isn't connected, message features say so and everything else in the app works as before.
- **New tables and columns** (your approval needed):
  - `contacts.ghl_contact_id`, unique per company.
  - `ghl_user_links`: the LOSuite person, their GHL user id, number and email, and when it was checked.
  - `messaging_settings`: one row per company with the quiet hours (default Mon–Sat 9am–9pm and Sun noon–9pm, Central time). It also says whether mps.mortgage is verified for sending: if yes, LOs email from their own address; if no, from info@mps.mortgage. There's no company phone number, because files without a linked LO are held for review.
  - `ghl_calls`: a log of every GHL call (when, what, answer code, ids, never the token).
- **Matching code** (`supabase/functions/ghl/match.ts`, pure and tested like `normalize.ts`). The order is: stored GHL id, then email (lowercased, trimmed), then the 10-digit phone against `contacts.phone_digits`. It never matches by name. The result is one of:
  - **matched**: one person;
  - **needs matching**: two or more people share it, or the email and phone point to different people;
  - **no match**.
- I won't use GHL's "upsert contact". Its docs say that when the email matches one contact and the phone matches another, it quietly updates the first. LOSuite decides the match itself.
- GHL contacts have an `ssn` field. LOSuite never reads or stores it.

### Phase 2: Inbound and the Messages tab (read only)

- **`messages` table:** company, person (empty until matched), loan, channel (reuses the existing `message_channel`: text or email), direction, body, subject, from, to, GHL message and conversation ids (unique, so nothing saves twice), status, sent and received times, who sent it, match status and reason.
- **Who sees messages:** a matched message is visible through `can_see_contact()`. Unmatched messages and the Needs matching list are visible only to the **admin** role (`sees_all_files()`, decision 1). Owners see only their own files' messages.
- **`ghl-inbound` function** (Verify JWT off, checks `GHL_WEBHOOK_SECRET` with the same safe comparison as lead intake). It gets the ping, reads the new messages from GHL, matches and saves them.
- **Catch-up every 10 minutes,** using Supabase's scheduler (pg_cron + pg_net). That's a new pattern that needs your approval; it's Supabase's built-in way to run something on a timer.
- **Opt-outs:**
  - A STOP reply or GHL DND turns off `sms_consent` / `email_consent` and records why, with a note on the person.
  - Only a person can turn consent back on, with a note, through `restore_consent()`.
  - A small `consent_events` history (new table) keeps every change.
  - Consent is currently yes, no or blank. I'd add `sms_opted_out_at` / `email_opted_out_at` so "never asked" and "said STOP" aren't confused.
- **Screens:**
  - The borrower **Messages** tab (one thread of texts and emails), the **Contact & consent** panel with the shared-phone note, and the **GoHighLevel** panel (linked, matched by, owner, last sync), as in your mockup.
  - A **Needs matching** list for admins, with "This is…" to attach a message to a person; that also saves the GHL id.
  - An Inbox unread count.

### Phase 3: Sending

- **The composer** on the Messages tab (Text or Email, "OK to text now · until 9 PM"), and **Approve & send** on Action Queue drafts. The existing payload `{channel, to, subject, body}` is reused.
- **A `send_message` task in `ghl`.** The server re-checks everything on every send, whatever the screen showed:
  1. the sender can see the person;
  2. consent is on, and there's no STOP or DND (GHL is re-checked live);
  3. it's inside quiet hours, worked out by a pure, tested `quietHours.ts`;
  4. an idempotency key: a unique key on the message row, saved before calling GHL, so a double click or retry can't send twice.
- **Sender (decision 3):** texts from the assigned LO's linked and confirmed GHL number. Email from the LO's own address if mps.mortgage is verified for sending, else info@mps.mortgage. The "verified" answer is a setting on `messaging_settings`, set once Connor confirms decision 8. If the file has no assigned LO, or the LO isn't linked or GHL no longer shows the number as theirs, nothing is sent. The message waits as **Needs review**, with the reason ("No loan officer on this file" or "Dave's GHL number isn't linked yet"). It shows on the file and in an admin list. An admin fixes it by assigning the file (`reassign_loan()`) or linking the LO; then the same message can be approved and sent. Every server check above runs again at that point.
- If the person has no GHL contact yet, LOSuite creates one only after its own match says "no one" (`POST /contacts/`), and only when someone sends (see question 6).

### Phase 4: The Today page and notifications (your first mockup)

- **Drafts to approve,** with Approve & send / Edit / Snooze / Skip and the chips (SMS consent, quiet hours OK, touches this week).
- **The notifications bell:** a reply needs you, needs matching (admins), delivered, opted out.
- **Delivery status** updates from the catch-up check.
- **Drafts:** template and code-built drafts work with AI off. The AI drafter switches on only when the Anthropic key is added.

### Possible breaking changes

- **Action Queue statuses:** `action_status` is pending / approved / edited / dismissed. Sending needs "sent", and Snooze needs a snoozed-until date. Adding a value to a Postgres enum can't be undone easily, so I'd add `sent_message_id` and `snoozed_until` columns instead.
- **Consent fields:** adding the opted-out dates changes what "consent" means on the closed-client screens and in the CSV import. A STOP will beat an imported "yes".
- **Who sees what:** messages follow file visibility. An LO who loses a file through `reassign_loan()` also loses its messages.
- **Today page layout** grows (drafts, bell). The Closings box stays where it is.
- **Your existing GHL workflows** could fire on things LOSuite does (see questions 6 and 7).

### Connor's decisions (Oct 29, 2026)

1. **Who sees messages:** messages follow the file rule in CLAUDE.md. Only the **admin** role sees every message and the Needs matching list. Owners, LOs and processors see messages only on files they can already see (`can_see_contact()` / `can_see_loan()`). Unmatched messages are admin-only.
2. **Match order:** stored GHL id, then email (lowercased, trimmed), then the 10-digit phone. Anything ambiguous goes to review. Never by name.
3. **Sender:**
   - Texts always go from the assigned LO's own GHL number.
   - Email goes from the LO's own address when mps.mortgage is verified as a sending domain in GHL, otherwise from info@mps.mortgage.
   - If the file has no LO linked to a GHL user, nothing sends, by text or email. The message goes to the admin review list (see 10).
4. **Workflows:** LOSuite never enrolls anyone in a GHL workflow in this build.
5. **Quiet hours:** Mon–Sat 9am–9pm and Sun noon–9pm, Central time, kept as a setting Connor can change. Connor is still confirming the window with compliance.
6. **Creating GHL contacts:** only when a person is first messaged, never in bulk. *Still to answer: which workflows start on Contact Created or Tag Added (or "none").*
7. *Still to answer: which "Customer Replied" workflows auto-reply (or "none").*
8. *Still to answer: which numbers are A2P-approved, and whether mps.mortgage is verified for sending (this also decides the email sender in 3).*
9. **Webhook:** use the plain **Webhook** action, which has no per-run charge, with the secret in the URL.
   - Each webhook is only a notice.
   - `ghl-inbound` checks the secret, then fetches the message from the GHL API itself before saving anything, so a fake or tampered webhook can't insert anything.
   - The scheduled check for missed messages stays.
10. **No linked LO:** there's no company-number fallback. A message for a file whose LO isn't linked to a GHL user doesn't send. It goes to a review list for an admin, who can reassign the file or link the LO first. New loan officers get their own GHL number.
11. **GHL-only users:** the two GHL users who don't use LOSuite are left out of user linking.

When Phase 1 is approved, these go into the CLAUDE.md decisions log.
