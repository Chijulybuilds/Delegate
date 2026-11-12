import type { SupabaseClient } from '@supabase/supabase-js';

let client: Promise<SupabaseClient> | null = null;

/** Loaded on demand so the landing page never pays for the auth SDK. */
export function getSupabase(url: string, anonKey: string): Promise<SupabaseClient> {
  if (!client) {
    client = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      }),
    );
  }
  return client;
}
