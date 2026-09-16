import {createClient, type SupabaseClient} from '@supabase/supabase-js';

/** Fallbacks match the mobile demo project so Vercel can host without secret wiring. */
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://phgjkhmklyybvgnceqmm.supabase.co';
const key =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  'sb_publishable_DdG9bYtXdHurqyVsd7R5Sg_drLA4r2W';

export function createOpsClient(): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and paste the anon key.',
    );
  }
  return createClient(url, key);
}

export const OPS_PIN = (import.meta.env.VITE_OPS_PIN as string | undefined) || 'burqora-ops';
