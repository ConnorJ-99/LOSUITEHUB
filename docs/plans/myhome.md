# MyHome with MPS

Status: Stage 0 approved by Connor 2026-11-19 ("Approve, start Stage 1"). Stage 1 built 2026-11-19, reworked 2026-11-20 to Connor's sign-in plan (below), approved and committed 2026-11-20 (f485208, "go for it"). Stage 2 built, set up on tlsq and committed 2026-11-20 after Connor tested MyHome. **Next (Connor, 2026-11-20): the closed view (Stages 4–5) before Nurture (Stage 3)**, planned first. Questions 4 (savings goal) and 5 (contact button) are still open (end of this file); 1–3 are settled.

## Connor's sign-in decisions (2026-11-20)
- **No Supabase emails or SMTP.** MPS-HQ makes each borrower a permanent 6-digit MyHome code and a personal link that never expires (`/myhome?invite=<64 hex>`).
- **Manual button.** "Send MyHome code to GHL" writes them to the borrower's GHL contact, in the custom fields `home_management_code` and `home_management_link`. It then adds the tag `home management code`, and Connor's GHL workflow emails his template (`{{contact.home_management_code}}`, `{{contact.home_management_link}}`). This is his exception to "LOSuite never adds tags or starts workflows", for MyHome only, on that click.
- **Primary borrower only.** Co-borrowers get no MyHome invite.
- **The link never expires.** "New code" replaces the code and link, and Turn off stops both.
- **The link asks for the code too (Connor, 2026-11-20, after testing).** The personal link opens "Create your account" and asks for the email and the 6-digit code; a wrong email and a wrong code get the same answer and count toward the lockout.
- **At closing (Connor, 2026-11-20, later).** The code stays on the borrower's GHL contact for good. When a file is marked Closed, the `ghl` function's opportunity move first writes the primary borrower's code and link into the two fields, with **no tag**: inviting them to MyHome first if they have no account, leaving them alone if MyHome is turned off. Then it moves the opportunity, and Connor's GHL closing email workflow (triggered by that Closed stage move, not a tag) includes the code. GHL isn't told whether they've signed in (Connor: not needed). A MyHome problem never stops the move; it comes back as a note (`myhome` on the result, shown as a toast). Rule `myHomeAtClose` in `supabase/functions/ghl/myhome.ts` (tested).
- **Connor's GHL workflows (2026-11-20):** the "home management code" workflow is built; it allows re-entry and removes the tag after it sends (MPS-HQ still takes the tag off and on, which is harmless). The closing workflow starts on the pipeline stage change, waits 1 day, then sends the closing email with the code and link. Only a Closed move made by MPS-HQ fills the fields first; a contact moved to Closed by hand in GHL gets whatever is already in them.
- **Set up on tlsq 2026-11-20 by Claude:** the script was run (its step 0 removed the empty first-draft tables), `myhome` and `ghl` redeployed (ghl again with the closing step). Connor made the two GHL custom fields; the workflows come later, and testing waits until then.

## Stage 1 — accounts and sign-in (built)
- Script `supabase/migrations/20270224000000_myhome_accounts.sql`:
  - `borrower_accounts` keeps `invite_code` and `invite_token`, which only the service role can read; logins get every other column. It also keeps `code_sent_at`.
  - `myhome_events`.
  - `invite_to_myhome(contact, new_code)` makes the code and link, or new ones; `turn_off_myhome()`.
  - `myhome_new_code()` and `myhome_new_token()`, made from `gen_random_uuid()`.
  - `handle_new_user()` makes no staff profile for a MyHome login, and trigger `organization_members_not_myhome` keeps MyHome logins off the team.
  - Service-role lookups `myhome_auth_user()` and `myhome_accounts_for_email()`.
  - PGlite test: 39/39 pass.
- Edge Function `myhome` (Verify JWT ON), with rules in `supabase/functions/myhome/rules.ts` (tested):
  - `sign_in`:
    - takes email + code, or the link + email;
    - locks the account for the hour after 5 wrong tries;
    - gives the same answer for a wrong email or a wrong code;
    - refuses a staff email;
    - makes or updates the MyHome login, then returns a one-time key from `generateLink`, which emails nothing. The page trades it for a session with `verifyOtp`.
  - `me` returns the borrower's name, files and LO card.
- `ghl` function task `myhome_code` (pure part in `supabase/functions/ghl/myhome.ts`, tested). It runs on the primary borrower only, follows test mode (TEST people only) and links the GHL contact first (`linkContact`). It then:
  1. reads the field ids (`locations/customFields.readonly`; without that scope it writes by key);
  2. writes both fields;
  3. takes the tag off and adds it again, so pressing again re-runs the workflow;
  4. records `code_sent_at` and a `code_sent` event.
- `/myhome` (`MyHomePage`, in `PublicApp`):
  - **Signing in:** the link asks for the email only ("Create your account"). Without the link, it asks for email + MyHome code. It runs on its own Supabase client (`createMyHomeClient`, storage key `mps-myhome-auth`), and the link's token leaves the address bar once used.
  - **Signed in:** file chips and the LO card. Each view is a placeholder until Stages 2–5.
- The staff app refuses a login with no team membership ("This is a MyHome account").
- The Borrower portal card has a **MyHome** line for the primary borrower: its status, **Send MyHome code to GHL** / **Send code again**, **New code**, and **Turn off**.

**Connor's setup before testing:**
1. Run the script in the SQL Editor. The last row should read "MPS HQ MyHome accounts installed": tables 2, policies 2, functions 7, staff_guard 1.
2. `npm run function:paste -- myhome`, then make a new Edge Function named `myhome` with Verify JWT on.
3. `npm run function:paste -- ghl`, then redeploy `ghl`.
4. In GHL, make the contact custom fields **home_management_code** and **home_management_link** (single-line text).
5. In GHL, build the workflow: trigger **Contact Tag added = "home management code"** → send the email template.
6. Optional: add the `locations/customFields.readonly` scope to the GHL token, so fields are written by id.

## Stage 2 — open files (built 2026-11-20)
- An open file (any stage but Nurture, Closed and Lost) in MyHome shows what the borrower portal shows, with the portal's own sections (`PortalHeader`, `Items`, `LettersAndHomes` take a `PortalCall` now, so `/u/{token}` and MyHome share them): where the loan stands, their document checklist with uploads (PDFs or photos into the file, the item marked received, the LO's `portal_upload` notice as before), published letters and estimates (one-minute PDF links), Request numbers on purchases, and that file's loan officer card.
- `myhome` function actions `file`, `upload_url` / `uploaded`, `pdf`, `home_request`. Each checks the signed-in account, that its person is a borrower on the file and that the file is open (else "That loan isn't in your MyHome" / "isn't open anymore", and the page reloads their loans). It reuses `document-upload/portal.ts` and `rules.ts` unchanged. Events in `myhome_events` with the file: `opened` (once per pick), `upload`, `pdf`, `home_request` (5 an hour per account).
- Script `20270225000000_myhome_active.sql`: `submit_myhome_request()` (service role only) does what `submit_portal_request()` does for a MyHome account instead of a portal link: the home on the file as interested, the request with the Approval Limits and how far over (`link_id` null), a note "(MyHome)" and the LO's `portal_request` notice. PGlite test 12/12.
- "Your numbers are ready" (publishing a letter or estimate for a requested home) points to `/myhome` once the borrower has signed in to MyHome (account active), else to their portal link as before (`readyLinkFor`, tested).
- Fixed in passing: the portal's `portalStep()` didn't know the `underwriting` stage, so a file at Underwriting with no milestones showed "Application received" on `/u/{token}`; it is now "Submitted to underwriting" (`document-upload` redeployed).
- `npm run function:paste` now names a sibling module's namespace after its folder when two modules share a name (`myhome`'s `rules.ts` and `../document-upload/rules.ts` → `document_upload_rules`).
- Not in MyHome yet: the portal's "Your mortgage application" card (the application runs on a portal link; Stage 5's "Start something new" brings it signed in).
- **Set up on tlsq 2026-11-20 by Claude:** script run ("MPS HQ MyHome active files installed", functions 1), `myhome` and `document-upload` redeployed, `myhome` checked (refuses a request that isn't signed in). Not tried signed in yet: that needs a TEST borrower's MyHome login.


## Closed view (Connor 2026-11-20: before Nurture; built in Steps A–C, his OK after each)
- **Step A — home, loan, Connor's value, asks (built 2026-11-20, not committed):**
  - Header for a closed file: "Welcome home, {first}", the address, "Closed March 2021 · Conventional 30-year" (`loanLine`: mortgage type + term, a home equity line, or the program name; tested). First names show with a capital letter.
  - **My home's value:** Connor's own `properties.estimated_value` with the month he set it (`estimated_value_on`, new, set by trigger), else "{LO} can take a look for you"; Zillow (address search) and the county appraisal district from Quick Links (`countyName` reads "Collin County", "collin"…; tested); **Ask {LO} to check my value** → `myhome_ask()`: a `value_check_requested` event, a note "(MyHome)" and the new `myhome_request` notice (Settings → Notifications); asking again within a day returns the first ask, and the page shows "Asked {date}". No Redfin button: Redfin has no dependable address-search link.
  - **My loan:** monthly payment, insurance renewal, homestead filed, home anniversary (the closing date), and **My closing documents** = documents Connor publishes on the closed file (Connor's choice). "Publish to borrower" now shows on every document of a closed file ("Share this in MyHome?"); open files still publish only letters and estimates. The old check constraint became trigger `loan_documents_publish_guard`.
  - `myhome` actions `closed`, `closed_pdf`, `ask` (the person must be a borrower on the closed file). Script `20270226000000_myhome_closed.sql` (PGlite 20/20). Set up on tlsq 2026-11-20 by Claude ("MPS HQ MyHome closed view installed"; `myhome` redeployed).
- **Step B — the automatic FHFA estimate (built and set up 2026-11-23, not committed):** `home_price_index` (any login reads; only the function writes) and `home_price_index_runs`, filled by the new Edge Function `hpi-refresh` (Verify JWT on; FHFA's master file read line by line, FRED as the backup; pure reading in `supabase/functions/hpi-refresh/hpi.ts`, tested and checked against both real files) every Monday (`mpshq-hpi-refresh`, Vault entries like the other timers) and by **Refresh now** in Settings → Home value index (owners/admins). `loans.appraised_value` ("Appraised value at closing" on a closed file's Overview) is the starting value for a refinance; a purchase starts from its price. The server sends the starting value, the index for the closing quarter and the latest, and the loan's own terms; the page works out the estimate (`src/lib/calc/homeValue.ts`: base × index growth to the nearest $1,000; Connor's figure wins when set on or after the index load) and the balance and equity with `mortgageToday()`. Areas: `areaForCounty` (Hood → Fort Worth, labeled nearest area). Script `20270227000000_myhome_home_value.sql` (PGlite 8/8). First load 2026-11-23: 400 quarters from FHFA, latest 2026 Q2. Not done: the Closing Disclosure reader filling the appraised value (typed by hand for now).
- **MyHome on closed files (Connor 2026-11-23):** the Borrower portal card isn't on a closed file's Overview, so a **MyHome** card there carries the primary borrower's MyHome line. The line (open and closed files) now also has **Copy link** and **Draft text / Draft email**: MyHome's plain address (`myHomeUrl`, no code in it) in an Action Queue draft (`myHomeInvite`, tested), sent only on a click.
- **Asks on the file (2026-11-23):** the closed file's MyHome card lists "Asked from MyHome" (`myhome_events` *_requested) with Save value & mark done / Mark done (`handle_myhome_ask()`, script `20270228000000_myhome_asks_handled.sql`, PGlite 7/7); the Closed loan card has **Estimated value** (dated by trigger).
- **Next, before Step C (Connor 2026-11-23, in this order, his OK after each):** (1) the CD fills in the home — **built and set up 2026-11-23, not committed:** new CD figures `property_address` (kind `address`, `splitCdAddress`, tested) and `appraised_value`; the review fills the address only when the file has no subject home (never renames one), and taxes/insurance then go along with it (`changesFor` sends the address first); script `20270229000000_cd_fills_home.sql` (apply makes or picks the subject home, current home for a primary residence else owned; undo takes it off and removes it when the CD added it; PGlite 11/11); `assistant` redeployed. A CD already applied needs "Upload a corrected CD" to be read with the new figures; (2) MyHome: My payment, the amortization table and an extra-payment calculator — **built 2026-11-23**: "What's in my payment" in My loan (P&I from the loan's terms, taxes and insurance from the home, the rest of the total as mortgage insurance & other); **My loan schedule** (payments made, payoff date, balance left, the table by year with this year highlighted and Show all years); **What if I pay extra?** (extra each month and a one-time amount from the next payment: new payoff date, how much sooner, interest saved; the table follows). `amortization()` takes `ExtraPayments` (monthly from a date, one-time on the next payment on or after its date) and `extraPaymentEffect()` (tested); `myhome` sends `annualTaxes` / `annualInsurance` (redeployed); (3) — **built 2026-11-23** (script `20270302000000_myhome_extra_payments.sql`, PGlite 16/16; `myhome` actions `extra_payment` / `remove_payment`; the schedule card has two tabs, **Estimate** (what-if, nothing saved) and **I made an extra payment** (logs date + amount, list with Remove); a logged payment counts on the most recent due date on or before the day paid (`loggedExtras`, tested), so the balance, equity, payoff date and table use it; payments count as made on each due date from the first payment date ("N of 360 made (through …)", "Next payment due …"); the closed file's Mortgage today lists them as "reported by the borrower" and counts them) — (3) extra payments the borrower actually made: **one-time payments only** (date + amount, Connor's choice), stored in a new table written only by `myhome`, used by MyHome **and** by the closed file's Mortgage today, marked "reported by the borrower".
- **Step C — equity and Start something new:** cash-out room, "You may be able to save about $X/mo" from Refi Watch benchmarks, Check refi / Check equity asks (`myhome_ask` already takes them), `myhome_settings`, Buy another home / Refinance this home into the application.

---

## Stage 0 report (discovery, no code)
Mockups: `MyHome borrower portal mockups.pdf` (4 screens). They set the content and layout only; MyHome is built with MPS-HQ's own components.

---

## 1. How the portal works today, and what changes

**Today (one link per borrower per file):**
- `document_upload_links` holds each link. A portal link (`kind = 'portal'`) lasts 90 days (an hour short, since `554777f`). It keeps a hash of the 64-character token, plus the token itself so staff can Copy it. There is one live portal link per borrower per file.
- **Email check.** On `/u/{token}` the borrower types an email. The `document-upload` Edge Function (no sign-in, service role) accepts it if it matches **any borrower on that file**. A co-borrower's email also opens the primary borrower's link.
- **Lockout.** Five wrong emails in an hour lock the link for the hour. Every try is a row in `document_link_events` (email_ok / email_wrong / locked / opened / upload / pdf / home_request / expired).
- **Session.** A correct email creates a random session key. Its hash and a 24-hour expiry go **on the link row itself** (`session_hash`, `session_expires_at`), and the phone keeps the key in localStorage. Each link holds only one session, so signing in on a second phone signs out the first.
- **What the page shows.** Every read and upload goes through the function: status step, checklist and uploads, published letters and estimates, home requests. The `apply` function reuses the same session for `/u/{token}?apply=1`.

**What has to change for real accounts:**
- **The key.** The way in becomes the **person** (one login per contact) instead of the link. A login opens **every file that person is a borrower on** (`loan_borrowers`): active, nurture and closed.
- **Sessions.** They move off the link row and into Supabase Auth, which supports several phones and keeps people signed in with refresh tokens.
- **The new function.** A new `myhome` Edge Function serves everything `document-upload` serves today (it reuses its pure files `portal.ts` and `rules.ts` unchanged), but per file the account can see. It also adds the nurture and closed views.
- **`/u/{token}` keeps working** for one-off document requests and for anyone without an account. Nothing is removed. Once someone has an account, the portal card can say "They use MyHome" and draft the `/myhome` link instead of a token link.
- **The activity record.** `document_link_events` stays tied to links. MyHome gets its own `myhome_events`, listed in section 6.

## 2. Email codes beside staff passwords: yes, with these guards

Supabase Auth can do both in one project. Staff keep `signInWithPassword`. Borrowers use `signInWithOtp({ email, options: { shouldCreateUser: false } })` and then `verifyOtp({ email, token, type: 'email' })`. The email carries a 6-digit code once the **Magic Link email template** shows `{{ .Token }}` instead of the link. Staff never use that template; password reset has its own.

**Things to know first:**
1. **Email service (needed before launch).** Supabase's built-in mailer only sends to your Supabase team's own addresses, a few an hour, so borrower codes need **custom SMTP** set in Supabase (Authentication → SMTP). Any transactional sender works, ideally from an mps.mortgage address. A login code is an automatic email. **Please confirm it's an allowed exception to "no auto-send".** It is a security code, not a message, and nothing else in MyHome ever sends.
2. **Text codes.** The mockup says "text or email you a code". Supabase's phone codes need an SMS provider (Twilio or similar) set up in Supabase, so I suggest **email only for now**.
3. **Sign-ups.** The app has no open sign-up. `shouldCreateUser: false` plus an invite means the `myhome` function creates the login itself (admin API) only for a contact Connor invited, and only when the typed email is that contact's email. Nobody can make an account by guessing.

**How staff and borrower sessions stay separate.** Your plan is right, with five additions:
- **a. Its own bundle.** `/myhome` lives in `PublicApp` (`main.tsx`'s public-address check adds `myhome`), so a borrower's phone never loads `App.tsx`, `AuthGate` or `AppShell`.
- **b. Its own storage key.** MyHome makes its own Supabase client with a separate `storageKey` (e.g. `mps-myhome-auth`). Connor's staff login and a test borrower login on the same browser then don't overwrite each other.
- **c. One gate.** All reads and writes go through `myhome`, which checks the caller's login → `borrower_accounts` (active) → `loan_borrowers` for every file. The browser never queries tables. RLS stays shut to borrower logins: every existing policy goes through `is_org_member()` / `can_see_loan()`, which need an `organization_members` row, so a borrower login sees nothing even if it calls the database directly.
- **d. The staff app refuses non-staff.** `AuthProvider` today lets a login with no `organization_members` row into `AppShell` (role empty). `AuthGate` will show "This is a MyHome account" with a link to `/myhome` and a Sign out button.
- **e. Two gaps the audit found:**
  - `handle_new_user()` makes a `profiles` row for **every** new login. Borrower logins should get none. They're marked in the login's app metadata, which only the server can set.
  - `add_member_by_email()` (Settings → Team) could add a borrower's login to the staff team. It should refuse a MyHome login.
  - Some database guards treat "a signed-in person" (`auth.uid() is not null`) as staff. Borrowers never call the database, so this is safe, but Stage 1 re-checks those functions.
- **Same email for staff and borrower:** MyHome refuses to invite an email that is already a staff login, and asks for a personal email instead.

## 3. Refi Watch: only the benchmark pricing is built

- **Built (step 1, `20261227000000_refi_watch_benchmarks.sql`):**
  - The tables `refi_benchmark_scenarios`, `refi_benchmark_runs` and `refi_benchmarks`.
  - The Mon/Wed/Fri task at 8 AM Central.
  - The pricing page `/refi-watch/benchmarks`, plus "stale pricing".
- **Not built:** comparing past clients against those benchmarks (screening), any alerts, and any savings math. Nothing reads the benchmarks yet.
- **What MyHome needs:** the "you may be able to save about $X/mo" line has to come from a small piece of that screening. It would be a pure, tested function: the borrower's loan (program, rate, term, estimated balance from `mortgageToday()`) against the latest saved benchmark for the closest scenario.
  - It computes the estimated principal-and-interest difference.
  - It shows nothing when pricing is stale, the savings are under a minimum, or the loan is VA/USDA (the scenarios are Conventional and FHA only).
  - Nothing is stored, and no rate, points or term ever reaches the borrower.
  - Staff-side Refi Watch alerts stay a separate later job.

## 4. Where "My numbers" lives, and how changes are recorded

| Figure | Where it lives (one place) |
|---|---|
| Account balances | `assets.amount`: one row per account per borrower on the loan, with `institution_name` and `account_last4` (last 4 only) |
| Debts | `liabilities.unpaid_balance` and `liabilities.monthly_payment`, per debt per borrower on the loan (mortgages are `property_liens`, not here) |
| Estimated credit score | `loan_borrowers.estimated_credit_score` (300–850), per borrower per loan |
| Home value | `properties.estimated_value`; insurance renewal and homestead filed are also on `properties` |

**How changes are recorded:**
- `loan_change_log` is append-only and written **only** by the `loans_log_changes` trigger.
- It records **only `loans` columns**: dates, comp, review, next action and nurture fields. The reason comes from the `mps.change_reason` setting.
- `changed_by` points to `profiles`, so a borrower (who has no profile) can't be named there.
- **Today, changes to assets, debts and the credit score are not recorded anywhere.**
- The Nurture mockup's "+23 since Aug" and "−$180 since Aug" need a history, which is why section 6 proposes extending `loan_change_log` (#5) instead of adding a second history.

**What the borrower edits.** MyHome edits the **Nurture file's** 1003 rows (application facts live on the loan). The borrower updates an existing account's balance, an existing debt's balance and payment, and their own score. Adding an account or debt is limited to type, institution, last 4 and amount; no full account numbers and no SSN.

## 5. FHFA House Price Index (confirmed 2026-11-19)

**The file.** The master file is at `https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv` (about 17 MB, 186,000 rows). I downloaded and read it.
- Its columns are `hpi_type, hpi_flavor, frequency, level, place_name, place_id, yr, period, index_nsa, index_sa, rstderr, note`.
- The place names contain commas, so it needs a real CSV reader.

**The two series:**

| Area | place_id | place_name | Latest (2026 Q2), all-transactions |
|---|---|---|---|
| Dallas | 19124 | "Dallas-Plano-Irving, TX (MSAD)" | 426.45 |
| Fort Worth | 23104 | "Fort Worth-Arlington-Grapevine, TX (MSAD)" | 400.37 |

- Rows use `hpi_type = traditional`, `frequency = quarterly`, `level = MSA`.
- Both areas have three flavors: `all-transactions` (from 1975, not seasonally adjusted, base 1995 Q1 = 100), `purchase-only` (from 1991) and `expanded-data`.
- **Recommendation: use all-transactions.** It is the series FRED republishes, so the backup gives the same numbers.
- **The backup works.** The FRED series `ATNHPIUS19124Q` = 426.45 and `ATNHPIUS23104Q` = 400.37 for Q2 2026 match the file exactly. FRED's CSV download needs no key.
- **Timing.** The next release (Q3 2026) is listed as Nov 24, 2026, so "Updated Q3 2026" in the mockup appears after that date.

**County → series (checked against the Census Bureau's 2023 metro area list):**

| Series | Counties |
|---|---|
| Fort Worth (23104) | Tarrant, Johnson, Parker, Wise |
| Dallas (19124) | Dallas, Collin, Denton, Ellis, Kaufman, Rockwall, Hunt |

- **Hood County is not in either area.** It is the Granbury micropolitan area, and FHFA publishes no Granbury series. Choices:
  - **(a)** use Fort Worth as the nearest series, labelled "nearest area index" (my suggestion);
  - **(b)** use the Texas statewide index;
  - **(c)** show no estimate for Hood.
- A home outside these 12 counties gets no estimate and only the "Ask Connor to check my value" button.
- County comes from `properties.county`, which is typed by hand. MyHome cleans it up ("Collin County", "collin" → Collin); a blank county falls back to Ask Connor.

**The math (pure, tested):**
- estimated value = **base value × (latest index ÷ index for the quarter it closed)**, rounded to the nearest $1,000;
- equity = estimated value − estimated balance (`mortgageToday()`);
- cash-out room = 80% of value − balance, never below $0.
- **The base value** is the purchase price on a purchase. A refinance has no stored appraised value today, so section 6 proposes one (the Closing Disclosure shows it on page 1, so the CD reader can fill it).
- If Connor has set `properties.estimated_value` more recently, his figure wins and is labelled as his.

## 6. New tables and columns to approve (Stages 1–6)

**Stage 1: accounts and sign-in**
1. **`borrower_accounts`** (new table): one row per person (contact) Connor invites to MyHome, holding the login it's tied to once they sign in, its status (invited / active / turned off), who invited them, and when they last signed in. RLS lets staff who can see the person read it; only the `myhome` function and staff functions (invite, turn off) change it.
2. **`myhome_events`** (new table): every MyHome sign-in, wrong code, view, upload, number update and request ("re-check me", "check my value", refi / equity check, start something new), with the person, the file and a small detail. This feeds the file's Activity and the Today card, and records whether staff handled each request. RLS: people who can see the file; only the function adds rows.
3. **Changes to two existing functions (no new columns):** `handle_new_user()` skips the staff profile for MyHome logins, and `add_member_by_email()` refuses them.

**Stage 2: active files**
- No new tables. `myhome` serves what the portal shows today from the same tables.

**Stage 3: nurture files**
4. **Notification kind `myhome_request`** (an existing list, extended): Connor gets notified when a borrower asks for a re-check, a value check, a refi or equity check, or starts something new.
5. **`loan_change_log.borrower_account_id` and `loan_change_log.record_id`** (two columns on the existing history): when a borrower updates a balance, debt or score from MyHome, the change goes into the same history with "changed by {name} (MyHome)" and which account or debt row changed. This powers "+23 since Aug" without a second history table. Only a service-role function writes these rows.

**Stage 4: home value**
6. **`home_price_index`** (new table): the quarterly FHFA index numbers for the two DFW series (series, year, quarter, index, source FHFA or FRED, loaded on). It's public data shared by the whole app: staff can read it, and only the refresh job writes it.
7. **`hpi-refresh`** (new Edge Function + pg_cron monthly): downloads the FHFA file and keeps only the two series' all-transactions rows, falling back to FRED when FHFA fails. An admin "Refresh now" button sits in the admin section.
8. **`loans.appraised_value`** (new column): the appraised value at closing, the base for a refinance's home value estimate, typed on Overview or filled by the Closing Disclosure reader. The script ends with `select public.grant_loan_columns();`.
9. **`properties.estimated_value_on`** (new column): the date Connor last set `estimated_value`, so MyHome knows whether his figure is newer than the index estimate.

**Stage 5: closed files and asks**
10. **`myhome_settings`** (new table, one row per company): MyHome on/off, the minimum monthly savings before the "you may be able to save about $X/mo" line shows (suggest $100), and whether the refi and equity cards show. Owners and admins edit it.
11. **`borrower_applications.borrower_account_id`** (new column): "Start something new" opens `/apply` already signed in and prefilled from the person's contact, and this records which MyHome account started it. Matching and new-file rules stay the existing lead intake's.

**Stage 6: the MPS-HQ side**
- No new tables. You get:
  - MyHome events on the file's Activity;
  - a Today card "MyHome requests" (open asks, Mark handled);
  - an Invite to MyHome button on the person and the portal card (it drafts the invite text and email in the Action Queue, never sends);
  - an admin section with the accounts list, Turn off, settings and index status.

## Questions for Connor
1. ~~**Login codes.**~~ Settled 2026-11-20: no Supabase emails; the permanent code goes by Connor's GHL workflow.
2. ~~**Hood County.**~~ Connor 2026-11-20: the Fort Worth index, labeled "based on the nearest area index".
3. **"My loan" on closed files.** The mockup shows their own monthly payment and "Conventional 30-year". That's their own loan, not an ad, but your "no term-based payment" rule is strict. Show their existing payment and loan type and term, or leave both off? **Connor 2026-11-20: show both.**
4. **Savings goal.** The mockup's "Saved $8,200 of $14,000" needs a goal. Nothing stores a cash-needed goal today. Show savings without "of $X", or work the goal out from the file's target price with the cash-to-close math?
5. **Contact button.** The chat bubble on the loan officer card can't be in-app messaging (out of scope). Make it a text (sms:) and call (tel:) link to your GHL number?
