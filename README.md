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
3. In the dev project's SQL Editor, run each file in `supabase/migrations/` in order (oldest first). Make sure no text is highlighted when you click Run, or only the highlighted part runs.
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
| `src/components/shared/` | Shared form and layout components every screen uses |
| `src/components/ui/` | Raw shadcn/ui primitives (wrapped by `shared/`) |
| `src/components/layout/` | App shell and sidebar |
| `src/pages/` | Screens |
| `src/lib/auth/`, `src/lib/supabase.ts` | Sign-in and the Supabase connection |
| `supabase/migrations/` | Database schema and Row Level Security |
