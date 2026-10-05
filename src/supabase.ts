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

export function createOpsClient(): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and paste the anon key.',
    );
  }
  return createClient(url, key);
}

export const OPS_PIN = (import.meta.env.VITE_OPS_PIN as string | undefined) || 'burqora-ops';
