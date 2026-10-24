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
3. In the dev project's SQL Editor, run `supabase/migrations/20261024000000_foundation.sql`.
4. Under Authentication → Users, add your user (email + password).
5. Run `supabase/seed.sql` in the SQL Editor to create MPS Mortgage LLC and make you the owner.
6. Restart `npm run dev` and sign in.

## Where things live

| Path | What |
| --- | --- |
| `src/lib/calc/` | All mortgage math (LTV, CLTV, PITI, DTI, cash to close), with tests |
| `src/components/shared/` | Shared form and layout components every screen uses |
| `src/components/ui/` | Raw shadcn/ui primitives (wrapped by `shared/`) |
| `src/components/layout/` | App shell and sidebar |
| `src/pages/` | Screens |
| `src/lib/auth/`, `src/lib/supabase.ts` | Sign-in and the Supabase connection |
| `supabase/migrations/` | Database schema and Row Level Security |
