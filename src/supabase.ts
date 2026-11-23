import {createClient, type SupabaseClient} from '@supabase/supabase-js';

/**
 * Fallbacks for hosted GitHub Pages (no .env).
 * Use the legacy anon JWT — browser supabase-js reports sb_publishable_ as "Invalid API key".
 */
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://phgjkhmklyybvgnceqmm.supabase.co';
const key =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoZ2praG1rbHl5YnZnbmNlcW1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODc0ODIsImV4cCI6MjA5NDE2MzQ4Mn0.IuwAL1QE_bU96UueulBjiBICK2H-k4Vt3K8XLX5ySjk';

let client: SupabaseClient | null = null;

/**
 * BUR-18: one client with a persisted Supabase Auth session. The anon key only identifies the
 * project; every ops write is a server function that checks the signed-in ops account.
 */
export function createOpsClient(): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and paste the anon key.',
    );
  }
  if (!client) {
    client = createClient(url, key, {
      auth: {persistSession: true, autoRefreshToken: true, storageKey: 'burqora-ops-auth'},
    });
  }
  return client;
}

export type OpsIdentity = {email: string; role: 'ops' | 'admin'};

/** Plain-language message for server errors raised by the ops functions. */
export function opsErrorMessage(message: string | undefined | null): string {
  const m = message || '';
  if (/ERR_OPS_FORBIDDEN/.test(m)) return 'Your account does not have ops access.';
  if (/ERR_OPS_ADMIN_REQUIRED/.test(m)) return 'Only an admin can do this.';
  if (/ERR_OPS_INVALID_COORDINATES/.test(m)) return 'Latitude/longitude are out of range.';
  if (/ERR_OPS_INVALID_RADIUS/.test(m)) return 'Radius must be between 50 and 2000 m.';
  if (/ERR_OPS_SHIFT_END_BEFORE_START/.test(m)) return 'Each shift must end after it starts.';
  if (/ERR_OPS_AUTH_USER_NOT_FOUND/.test(m)) return 'No login exists for that email. Create it in Supabase Auth first.';
  if (/ERR_OPS_CANNOT_DEMOTE_SELF/.test(m)) return 'You cannot remove your own admin access.';
  if (/JWT|not authenticated|permission denied/i.test(m)) return 'Your session expired. Sign in again.';
  return m || 'Something went wrong.';
}
