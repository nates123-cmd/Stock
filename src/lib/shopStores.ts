/**
 * Store tags + fulfillment routing (redesign Phase D, notes 3 & 4).
 *
 * A store tag on a shopping item is its fulfillment channel:
 *  - Wegmans → ordered via Instacart / the Beelink instacart-agent (external;
 *    not wired from the app yet — items just group under Wegmans).
 *  - Stop One / unassigned / everything else → pushed to the Apple Reminders
 *    list "Shared Groceries" via an installed Shortcut (`shortcuts://`).
 *
 * STORES is the single, configurable seed list — add a row here and it shows
 * up in the detail sheet and the group-by-store headers.
 */

export type StoreId = 'wegmans' | 'costco' | 'stopone';

export const STORES: { id: StoreId; label: string }[] = [
  { id: 'wegmans', label: 'Wegmans' },
  { id: 'costco', label: 'Costco' },
  { id: 'stopone', label: 'Stop One' },
];

export function storeLabel(id: StoreId | null | undefined): string {
  if (!id) return 'Unassigned';
  return STORES.find((s) => s.id === id)?.label ?? 'Unassigned';
}

/** Optional per-item detail set from the long-press sheet (note 3). */
export type ShopMeta = {
  store?: StoreId | null;
  qty?: string;
  brand?: string;
  note?: string;
  /** ISO timestamp of an explicit "Move to Staples". An explicit defer beats a
   *  low/out flag that was already standing when you deferred — otherwise you
   *  could never park something that's currently low ("we need pine nuts, but
   *  not soon"). A low/out flag raised AFTER this timestamp still re-surfaces
   *  the item onto Active. */
  deferredAt?: string;
};

/** The Apple Shortcut name Nate installs once (see SHORTCUTS.md). */
export const REMINDERS_SHORTCUT = 'Add Shared Groceries';

/**
 * Build the `shortcuts://run-shortcut` deep link that hands a newline-joined
 * item list to the "Add Shared Groceries" Shortcut, which files each line into
 * the Apple Reminders list "Shared Groceries" (note 4). Returns null when there
 * is nothing to send.
 */
export function remindersDeepLink(itemNames: string[]): string | null {
  const clean = itemNames.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  const text = encodeURIComponent(clean.join('\n'));
  const name = encodeURIComponent(REMINDERS_SHORTCUT);
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${text}`;
}
