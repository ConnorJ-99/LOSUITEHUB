# LOSuite

Internal CRM for MPS Mortgage LLC (NMLS #2501110). See [CLAUDE.md](CLAUDE.md) for the full project guide, rules and build phases.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Without a `.env.local` the app runs in **preview mode** (sample user, nothing saved).

```bash
npm test
```

Runs the unit tests for the mortgage math in `src/lib/calc/`.

## Connect the dev Supabase project

1. Create a **separate dev project** at supabase.com (never use production).
2. Copy `.env.example` to `.env.local` and paste in the dev project's URL and anon key (Project Settings → API).
3. In the dev project's SQL Editor, run each file in `supabase/migrations/` in order (oldest first). Make sure no text is highlighted when you click Run, or only the highlighted part runs. Newer scripts end with a confirmation row ("LOSuite … installed"); if you do not see it, the whole script did not run.
4. Under Authentication → Users, add your user (email + password).
5. Run `supabase/seed.sql` in the SQL Editor to create MPS Mortgage LLC and make you the owner. It is safe to run again.
6. Restart `npm run dev` and sign in.

If the Phase 1 migration (`20261025000000_contacts_pipeline.sql`) fails partway, run `supabase/cleanup_partial_phase1.sql` and then the migration again. The cleanup refuses to run anywhere except the LOSuite dev database.

## Where things live

| Path | What |
| --- | --- |
| `src/lib/calc/` | All mortgage math (LTV, CLTV, PITI, DTI, cash to close), with tests |
| `src/lib/pipeline/` | Stages, purposes, search and days-in-stage helpers, with tests |
| `src/lib/api/` | Loading and saving data (TanStack Query + Supabase) |
| `src/components/pipeline/`, `src/components/leads/` | Pipeline board/list, stage menu, New Lead and Edit forms |
| `src/components/profile/` | Borrower profile tabs: Overview (purpose-aware), Notes, Properties, tasks |
| `src/lib/dates.ts` | Due-date labels and "2 days ago" style times, with tests |
| `src/components/urla/`, `src/lib/urla/`, `src/lib/api/urla.ts` | The 1003 tab: sections, answer lists and data |
| `src/pages/SettingsPage.tsx` | Your profile and company details (used by 1003 section 9) |
| `src/lib/calc/income/`, `src/lib/income/`, `src/components/income/` | The Income tab: wage, variable, self-employed, bank statement and rental worksheets, and push-to-1003 rules, with tests |
| `src/lib/prequal/`, `src/lib/calc/prequal.ts`, `src/lib/calc/mortgageInsurance.ts`, `src/components/prequal/` | The phone prequal: draft and save rules, max price, quick checks and mortgage insurance, with tests |
| `src/lib/mismo/` | MISMO 3.4 (ULAD) export and import: XML writer/reader, field mapping, checklist, import matching rules, with round-trip tests |
| `src/components/shared/` | Shared form and layout components every screen uses |
| `src/components/ui/` | Raw shadcn/ui primitives (wrapped by `shared/`) |
| `src/components/layout/` | App shell and sidebar |
| `src/pages/` | Screens |
| `src/lib/auth/`, `src/lib/supabase.ts` | Sign-in and the Supabase connection |
| `supabase/migrations/` | Database schema and Row Level Security |
