# Launch: website forms + old data, same day (2026-11-02)

The Launch step from `next-build.md`: move the old app's clients into LOSuite and point the mps.mortgage forms at LOSuite on the same day, so no lead is split between two systems.

## 1. Form check: what the website sends vs. what LOSuite reads

Checked against the live site's code on 2026-11-02 (read only, nothing submitted). Every form goes through one function in the site, which sends `{ form_type, payload }` to the site's own server function `loan-sweet-intake`, which forwards to the old app today. The site also keeps its own backup copy and Zapier webhooks; the switch doesn't change those.

**Confirmed with `loan-sweet-intake`'s code** (Connor pasted it 2026-11-02): borrower forms are forwarded flat and unchanged, plus `source: "mps_mortgage"`, to the lead address. The partners page form (`partner_inquiry`) is reshaped and sent to the `/partner` address as `first_name`, `last_name`, `name`, `contact_type` (realtor, builder or other), `brokerage`, `email`, `phone` and `notes`; its text consent and UTM tags arrive only as lines in `notes` ("SMS consent: yes"), with no `form_type`. Submissions with no email and no phone are never sent. Both go with the `X-Intake-Secret` header, which lead-intake already checks.

Forms found: the multi-step form (`mortgage_preapproval`, `refinance`), home equity (`home_equity`), contact (`contact`), hard money (`hard_money`), the Caddie chat hand-off (`caddie_chat`), realtor prequal survey and connect-with-realtor (`realtor_referral`), open house (`realtor_open_house_prequal`), and the partners page (`partner_inquiry`).

| # | What the website does | What LOSuite did | Fixed? |
|---|---|---|---|
| 1 | The multi-step form fills every unanswered question with the word **"empty"** | Saved "empty" as the lead source, timeline and last name | Yes: "empty" counts as blank and isn't kept with the answers |
| 2 | Credit is sent as **`credit_range`** ("700-739", "740+", "Below 620") | Only read `credit_score`, so the estimated score was lost | Yes. "Below 620" is saved as 619 (under the conventional minimum) |
| 3 | Down payment can be **a percent** (`down_payment_mode: percent`, value 10) | Read 10 as $10, so the loan amount came out as price − $10 | Yes: 10% of the price |
| 4 | Under contract, the price is **`contract_price`**; the open house form sends **`listingPrice`** | Neither was read | Yes |
| 5 | Refinance home value is **`current_value`** / `current_home_value`; balance `current_home_balance` | Not read | Yes (read; kept with the web form answers, see gap A) |
| 6 | Refinance goal is **`refinance_goal`** ("Take cash out", "Pay off/consolidate debt", "Access my equity") | Every refinance became rate/term | Yes: those three are cash-out |
| 7 | Home equity sends **`product_interest`** ("HELOC", "Home equity loan", "Not sure — compare both") and form type `home_equity` | Became a **Purchase** | Yes: HELOC / HELOAN (not sure = HELOC) |
| 8 | **Occupancy "Investment property"** on the multi-step form | Became a Purchase | Yes: Investment / DSCR |
| 9 | Hard money form | Became a Purchase | Yes: Investment / DSCR |
| 10 | Partners page form type is **`partner_inquiry`** (the relay sends it to `/partner`) | Would have made a borrower lead if it ever reached the plain address | Yes: `partner_inquiry` is always a partner inquiry (a safety net) |
| 11 | Most forms have an optional **"text me" box** (`sms_consent`); for partners the relay sends it only as **"SMS consent: yes" in `notes`** | Ignored, so web leads and partners had no text consent | Yes: checked = text consent on (database script), with a consent record saying it came from the web form; lead-intake reads the partner line from `notes`. Someone who opted out stays opted out |
| 13 | The relay names the partner type in **`contact_type`** ("builder") | Read only `partner_type`, so every builder was saved as a realtor | Yes (database script): `contact_type` counts |
| 12 | The multi-step form **posts again after each step** with the same `lead_id` | Each step after the first added a note and a follow-up task to the same file, and its answers never reached the file | Yes (database script): later steps fill blanks on the file (price, loan amount, credit, timeline), add no note or task, and Today shows the form once |

Not changed (kept with the submission under **Web forms** on the file, nothing lost):

- **A.** Refinance home value and current balance aren't written onto the file (a lead has no home or lien record yet).
- **B.** A price range answer ("$300,000 - $400,000") isn't turned into a price.
- **C.** The agent named on realtor prequal and open house forms isn't added to the file's team.
- **D.** Income, debts, assets, first-time buyer and military answers aren't written into the Prequal tab.
- **E.** The website sends no submission id, so the exact same submission sent twice would be saved twice (the multi-step steps are grouped by `lead_id`, item 12).
- **F.** The contact and chat forms have no loan purpose, so those leads start as Purchase.

- **G.** Partner leads' UTM tags and landing page arrive only inside `notes`; they're kept with the submission, not as tracking.

Files: `supabase/functions/lead-intake/normalize.ts` (tests in `normalize.test.ts`), `index.ts` passes consent and `lead_id`, and `supabase/migrations/20261216000000_launch_intake.sql` (PGlite: 19 checks, including a re-run and a partial run).

## 2. The data migration

**What moves:**
- Closed clients and files in process: ARIVE's pipeline export (the import already reads it as it comes).
- Open leads that aren't in ARIVE yet (Lead, Contacted, Pre-Qualified, Pre-Approved): the old app's export.
- Realtors, title and builders: a partner list (name, company, email, phone, type).
- **Not moved:** Nurture clients (they stay in GHL only).

**How:** `node scripts/build-migration.mjs --owner connor@mps.mortgage --partners partners.csv arive.csv old-app-leads.csv`
- Every client row goes through the same checks as Contacts → Import CSV (`src/lib/import/clients.ts`) and the same `import_clients()`: matched by old site ID, then email, then phone, then name + address for closed loans. A match only gets blanks filled; nothing is overwritten and no stage moves. One person, one record.
- Partners go through `find_or_create_partner()` (email or phone, never name), before the clients, so agents on the moved files link to them.
- It writes three files to `supabase/.paste/` (git-ignored, because they hold client data): a **PREVIEW** script (saves nothing), the real script, and a report of rows left out (with the reason) and columns that aren't moved. Social Security / tax ID columns are never read.
- The script runs as Connor's owner login for its own transaction only (`import_clients()` checks who is signed in), and ends with one row: added, filled in, unchanged, not moved, partners added and matched, and each problem by file and row. Running it twice changes nothing the second time.
- Tested in PGlite with TEST data (16 checks: preview saves nothing, save, re-run, partial run then full run, wrong owner stops everything). Logic in `src/lib/import/migration.ts` (tests in `migration.test.ts`).

**Needs from Connor:** the files themselves. Export them yourself (ARIVE → pipeline report; the old app's export or its Supabase Table Editor → Export to CSV; your realtor list) and save them outside the LOSUITEHUB folder or in `LOSUITEHUB/supabase/.paste/old-app/`. Claude never opens the old app's `.env` and never connects to the old app's database.

## 3. Cutover day (Connor)

**Any day before:**
1. SQL Editor (the LOSuite project, ref starts with `tlsq`): paste `supabase/migrations/20261216000000_launch_intake.sql`, run it all, and look for **"LOSuite launch intake installed"** with five 1s.
2. Edge Functions → lead-intake: paste `supabase/.paste/lead-intake.ts`, deploy. **Verify JWT stays OFF.**
3. Send Claude the exports once, to build and check a PREVIEW (fix anything the report lists).

**On the day, in this order:**
1. Morning: export fresh copies of the same files and tell Claude where they are. Claude builds the scripts.
2. Run `old-app-migration-PREVIEW.sql`. Read the last row: the counts and the problems list. Nothing is saved.
3. Run `old-app-migration.sql`. Last row: **"LOSuite old app migration finished"**.
4. Run it once more. Everything should say unchanged (proves nothing doubled).
5. Switch the website. This is the **website's** project, not LOSuite's. The address and secret live in `supabase/functions/_shared/loanSweet.ts` and its Edge Function secrets:
   - Change the two address lines to:
     ```ts
     export const LOAN_SWEET_URL = "https://tlsqybatsmnfswjkkfph.supabase.co/functions/v1/lead-intake";
     export const LOAN_SWEET_PARTNER_URL = "https://tlsqybatsmnfswjkkfph.supabase.co/functions/v1/lead-intake/partner";
     ```
   - Edge Function secrets: set `LOAN_SWEET_INTAKE_SECRET` to the same value as LOSuite's `LEAD_INTAKE_SECRET` (LOSuite project → Edge Functions → Secrets; at least 16 characters).
   - Redeploy `loan-sweet-intake` **and every other website function that imports `_shared/loanSweet.ts`** (each one bundles its own copy of the addresses). If you build the site in Lovable, ask it: "update LOAN_SWEET_URL and LOAN_SWEET_PARTNER_URL in _shared/loanSweet.ts to these addresses and redeploy every function that uses it."
   - Nothing else changes: the header (`X-Intake-Secret`), the payloads, the website's backup copy, its sync log and the Zapier webhooks stay as they are.
6. Test: on mps.mortgage, fill in the Get Started form as **"Test TEST"** with your own email, and the partners page form as a builder named **"Partner TEST"**. In LOSuite, Today should show both web forms, the new lead with its drafted first text and email, and a builder on Partners. In the website's `loan_sweet_sync_log` both should say `synced`. Then delete the TEST lead and the TEST partner.
7. Turn off GHL test mode so real clients' texts and emails come in (there's no button for it yet). In the SQL Editor: `update public.messaging_settings set inbound_mode = 'all';`
8. Stop using the old app for new work (keep it to look things up), and delete the exports and `supabase/.paste/old-app-migration*.sql` from your computer.

Steps 2–5 should happen within the same hour, so a form sent mid-switch lands in one place: anything that reaches the old app before step 5 is picked up by re-running the migration after a fresh export.
