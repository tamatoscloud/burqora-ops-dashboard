# BurqOra Ops Dashboard (web)

Web console for ops staff: edit locations, add users, assign shifts, approve employee phones, review attendance.
Ops staff sign in with Supabase Auth; every change runs as a server function that checks ops access and is logged with who did it (BUR-18).

## Setup

```bash
cp .env.example .env
```

Put the Supabase **anon / publishable** key into `VITE_SUPABASE_ANON_KEY`. The key only identifies the
project; it cannot change data on its own.

## Rollout order (from the PIN version)

Migration 022 removes the anon write access the old PIN dashboard used, so ship in this order:

1. Create the first admin login (steps below) **before** applying 022, then apply migration 022
   (app repo `supabase/migrations/022_ops_auth.sql`).
2. Deploy this dashboard right after. Between steps 1 and 2 the old PIN dashboard can still read but
   every save fails.
3. Remove the `VITE_OPS_PIN` env var from Vercel; it is no longer used.

## Locking app data to activated phones (BUR-17)

Migration 023 limits the mobile app's key to the rows of the employee whose **activated** phone sent
the request. Until it is switched on, the database behaves as before, so phones on older builds keep
working.

1. Apply migration `023_device_scoped_rls.sql` (app repo `supabase/migrations/`). Nothing changes for users yet.
2. Ship the app build that sends the install headers (every Supabase request), and wait until every
   employee has updated.
3. **Devices** tab → **Lock data to activated phones** (admins only). From then on:
   - each phone sees only its own employee's shifts, attendance, profile and push tokens;
   - a phone that is pending, revoked or on an old build sees no employee data;
   - nobody can delete attendance through the app key.
4. If something goes wrong, **Unlock data access** restores the previous behaviour immediately.

## Giving someone ops access

1. Supabase → Authentication → Users → **Add user** (email + password).
2. First admin only — in the SQL editor:

   ```sql
   INSERT INTO public.ops_users (auth_user_id, email, role)
   SELECT id, email, 'admin' FROM auth.users WHERE email = 'you@company.com';
   ```

3. After that, an admin grants access without SQL access to the database:
   `select ops_set_access('teammate@company.com', 'ops');` (role `ops` or `admin`;
   pass `false` as a third argument to disable an account).

Turn **off** public sign-ups in Supabase → Authentication → Providers → Email. A self-signed-up
account has no ops access anyway, but there is no reason to allow it.

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Notes

- Schedule wall times for Asia/Karachi / Eastern are approximated in the browser; for exact TZ seeding prefer `supabase/seed/*.sql`.
- All writes go through `ops_*` server functions (migration 022). The anon key can no longer write
  locations, schedules or sync rows.
- Admin-only: device enforcement on/off, activation code, granting ops access. Ops: approve / reset
  phones, locations, users, shifts.
- Failure-log table + automated test runner are stubs for the next iteration.
