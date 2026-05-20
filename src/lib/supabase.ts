/**
 * Supabase client — auth + per-user cloud sync (spec direction:
 * [[project_stock_is_a_pwa]]). Same project as the claude proxy. The anon
 * key is publishable and safe in the client; RLS scopes every row to
 * auth.uid() = user_id, and policies are defined in
 * supabase/migrations/20260519000000_user_sync_init.sql.
 *
 * `supabase` is `null` until both env vars are set — that lets the app keep
 * working in pure local mode (no sign-in available) when sync isn't wired,
 * the same graceful-degrade pattern the Claude bridge uses.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_AVAILABLE = !!(URL && ANON);

export const supabase: SupabaseClient | null = SUPABASE_AVAILABLE
  ? createClient(URL as string, ANON as string, {
      auth: {
        // Persist the session so reload keeps you signed in.
        persistSession: true,
        autoRefreshToken: true,
        // Magic-link callbacks return with a `code` in the URL hash on web —
        // supabase-js handles the exchange automatically when this is on.
        detectSessionInUrl: true,
      },
    })
  : null;
