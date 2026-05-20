/**
 * Auth store — magic-link sign-in via Supabase, source of truth for the
 * sync layer (signed in = cloud-backed, signed out = local-only).
 *
 * Hydrate is called once in the root layout. It pulls the persisted session
 * (supabase-js stores it in localStorage with persistSession=true), then
 * subscribes to auth-state changes so the rest of the app reacts to sign-in /
 * sign-out / token refresh without polling.
 */
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, SUPABASE_AVAILABLE } from '@/lib/supabase';

type AuthState = {
  session: Session | null;
  user: User | null;
  /** initial getSession() has completed; gates "loading…" UI */
  ready: boolean;
  busy: boolean;
  error: string | null;
  /** email a magic link was just sent to (null until/after success) */
  pendingEmail: string | null;
  hydrate: () => Promise<void>;
  signInWithEmail: (email: string, redirectTo: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** clear the "check your inbox" state to try a different email */
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  ready: false,
  busy: false,
  error: null,
  pendingEmail: null,

  hydrate: async () => {
    if (!SUPABASE_AVAILABLE || !supabase) {
      set({ ready: true });
      return;
    }
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null, ready: true });
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
    });
  },

  signInWithEmail: async (email, redirectTo) => {
    if (!supabase) {
      set({ error: 'Sync not configured for this build.' });
      return;
    }
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      set({ error: 'That email doesn’t look right.' });
      return;
    }
    set({ busy: true, error: null });
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) set({ busy: false, error: error.message });
    else set({ busy: false, pendingEmail: trimmed });
  },

  signOut: async () => {
    if (!supabase) return;
    set({ busy: true });
    await supabase.auth.signOut();
    set({ busy: false, pendingEmail: null });
  },

  reset: () => set({ pendingEmail: null, error: null }),
}));
