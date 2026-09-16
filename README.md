# BurqOra Ops Dashboard (web)

PIN-gated web console for demo/ops: edit locations, add users, assign shifts, review attendance.

## Setup

```bash
cd ops-dashboard
cp .env.example .env
```

Put the Supabase **anon / publishable** key into `VITE_SUPABASE_ANON_KEY`.
Optional: change `VITE_OPS_PIN` (default `1234`).

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Notes

- Schedule wall times for Asia/Karachi / Eastern are approximated in the browser; for exact TZ seeding prefer `supabase/seed/*.sql`.
- Location / schedule **writes** need open RLS (mock-auth demo policies) or a service-role path later.
- Failure-log table + automated test runner are stubs for the next iteration.
