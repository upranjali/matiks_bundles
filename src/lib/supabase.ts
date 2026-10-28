import { createClient } from '@supabase/supabase-js';

// Publishable (anon) key only. It can't read any table: every table is locked by row-level
// security to signed-in admins, and creators only reach token-checked database functions.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = !!url && !!key;
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export function errText(e: unknown): string {
  const m = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/row-level security|permission denied|not authorized/i.test(m)) return 'You don’t have permission to do that.';
  if (/duplicate key/i.test(m)) return 'That already exists.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Couldn’t reach the server. Check your connection and try again.';
  return m;
}
