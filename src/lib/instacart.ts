/**
 * Send a shopping list to the Instacart auto-fill agent.
 *
 * Writes a row to the Supabase `instacart_jobs` queue; a poller on the Beelink
 * (nates123-cmd/instacart-agent) claims it and fills the Wegmans-on-Instacart
 * cart with the matching products. Checkout stays manual (Pickup).
 *
 * `dest` marks where each item goes:
 *   - 'IC' → the Instacart cart (the Beelink fills it)
 *   - 'LO' → local pickup; NOT sent to the Beelink. The caller routes LO items
 *            to Apple Reminders "Shared Groceries" via an iOS Shortcut.
 */
import { supabase } from './supabase';
import type { ShoppingLine } from './shopping';

export type JobItem = { name: string; dest: 'IC' | 'LO'; qty: number };

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export const INSTACART_AVAILABLE = () => !!supabase;

/** Map buy lines → job items. Everything defaults to the Instacart cart. */
export function toJobItems(lines: ShoppingLine[], local?: Set<string>): JobItem[] {
  return lines.map((l) => ({
    name: l.name,
    dest: local?.has(l.name) ? 'LO' : 'IC',
    qty: 1,
  }));
}

/**
 * Queue an Instacart fill. Only IC items are sent to the Beelink (LO items are
 * handled on-device). Returns the job id, or throws.
 */
export async function sendToInstacart(items: JobItem[]): Promise<string> {
  if (!supabase) throw new Error('Sign in to send to Instacart.');
  const ic = items.filter((i) => i.dest === 'IC');
  if (!ic.length) throw new Error('No items marked for Instacart.');
  const { data, error } = await supabase
    .from('instacart_jobs')
    .insert({ items }) // user_id defaults to auth.uid() via the column default
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Poll a job's status once. */
export async function jobStatus(
  id: string,
): Promise<{ status: JobStatus; result: unknown; error: string | null } | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('instacart_jobs')
    .select('status, result, error')
    .eq('id', id)
    .single();
  return (data as { status: JobStatus; result: unknown; error: string | null }) ?? null;
}

/**
 * Fire the one-time iOS Shortcut that adds local-pickup items to the shared
 * "Shared Groceries" Reminders list. No-op with a returned false if not on a
 * platform that can open the shortcuts:// scheme.
 */
export function sendLocalToReminders(localNames: string[]): boolean {
  if (!localNames.length) return false;
  const text = encodeURIComponent(localNames.join('\n'));
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(
    'Add to Shared Groceries',
  )}&input=text&text=${text}`;
  try {
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = url;
      return true;
    }
  } catch {
    /* not available */
  }
  return false;
}
