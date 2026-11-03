# Launch: website forms + old data, same day (2026-11-02)

The Launch step from `next-build.md`: move the old app's clients into LOSuite and point the mps.mortgage forms at LOSuite on the same day, so no lead is split between two systems.

## 1. Form check: what the website sends vs. what LOSuite reads

Checked against the live site's code on 2026-11-02 (read only, nothing submitted). Every form goes through one function in the site, which sends `{ form_type, payload }` to the site's own server function `loan-sweet-intake`, which forwards to the old app today. The site also keeps its own backup copy and Zapier webhooks; the switch doesn't change those.

**Still to confirm:** `loan-sweet-intake` runs on the website's server, so its code isn't visible from the site. If it reshapes the data before forwarding, the list below may change. Connor: please paste its code (website's Supabase → Edge Functions → loan-sweet-intake).

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
| 10 | Partners page sends form type **`partner_inquiry`**; we don't know yet whether `loan-sweet-intake` sends it to `/partner` | On the plain address it would have made a borrower lead out of a realtor | Yes: `partner_inquiry` is always a partner inquiry |
| 11 | Most forms have an optional **"text me" box** (`sms_consent`) | Ignored, so web leads had no text consent | Yes (database script): checked = text consent on, with a consent record saying it came from the web form. Someone who opted out stays opted out. Same for partners |
| 12 | The multi-step form **posts again after each step** with the same `lead_id` | Each step after the first added a note and a follow-up task to the same file, and its answers never reached the file | Yes (database script): later steps fill blanks on the file (price, loan amount, credit, timeline), add no note or task, and Today shows the form once |

Not changed (kept with the submission under **Web forms** on the file, nothing lost):

- **A.** Refinance home value and current balance aren't written onto the file (a lead has no home or lien record yet).
- **B.** A price range answer ("$300,000 - $400,000") isn't turned into a price.
- **C.** The agent named on realtor prequal and open house forms isn't added to the file's team.
- **D.** Income, debts, assets, first-time buyer and military answers aren't written into the Prequal tab.
- **E.** The website sends no submission id, so the exact same submission sent twice would be saved twice (the multi-step steps are grouped by `lead_id`, item 12).
- **F.** The contact and chat forms have no loan purpose, so those leads start as Purchase.

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
1. SQL Editor (the LOSuite project, ref starts with `tlsq`): paste `supabase/migrations/20261216000000_launch_intake.sql`, run it all, and look for **"LOSuite launch intake installed"** with four 1s.
2. Edge Functions → lead-intake: paste `supabase/.paste/lead-intake.ts`, deploy. **Verify JWT stays OFF.**
3. Send Claude the exports once, to build and check a PREVIEW (fix anything the report lists).

**On the day, in this order:**
1. Morning: export fresh copies of the same files and tell Claude where they are. Claude builds the scripts.
2. Run `old-app-migration-PREVIEW.sql`. Read the last row: the counts and the problems list. Nothing is saved.
3. Run `old-app-migration.sql`. Last row: **"LOSuite old app migration finished"**.
4. Run it once more. Everything should say unchanged (proves nothing doubled).
5. Switch the website: in the **website's** Supabase project, Edge Functions → `loan-sweet-intake`, change the address it forwards to into `https://<LOSuite project>.supabase.co/functions/v1/lead-intake` (partner inquiries may use `.../lead-intake/partner`), and the secret into the value of `LEAD_INTAKE_SECRET`, sent in the `X-Intake-Secret` header. Claude will write the exact lines once you paste that function's code.
6. Test: on mps.mortgage, fill in the Get Started form as **"Test TEST"** with your own email. In LOSuite, Today should show the web form, the new lead and its drafted first text and email. Then delete the TEST lead.
7. Turn off GHL test mode so real clients' texts and emails come in (there's no button for it yet). In the SQL Editor: `update public.messaging_settings set inbound_mode = 'all';`
8. Stop using the old app for new work (keep it to look things up), and delete the exports and `supabase/.paste/old-app-migration*.sql` from your computer.

Steps 2–5 should happen within the same hour, so a form sent mid-switch lands in one place: anything that reaches the old app before step 5 is picked up by re-running the migration after a fresh export.
