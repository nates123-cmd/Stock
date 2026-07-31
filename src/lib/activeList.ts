/**
 * Active shopping list — the row rules, as PURE functions.
 *
 * This logic used to live inline in shopping.tsx (a 3k-line component), which
 * meant the single most load-bearing surface in the app had zero tests and a
 * failure class nobody could reproduce: rows that vanished without being
 * deleted, and rows that reappeared after being cleared.
 *
 * The root cause of BOTH was the same: a pushed marker was matched against a
 * row by NAME, loosely.
 *
 *   - Too loose in one direction: `baseIngredient(pushedKey) === baseIngredient(row)`
 *     with no guard. Every ingredient's "base" is its LAST WORD, so pushing
 *     "green onions" silently hid "red onions"; "olive oil" hid "sesame oil";
 *     "chicken broth" hid "vegetable broth". Those rows dropped off Active AND
 *     never showed in the Pushed section (which lists pushed *markers*, not
 *     rows) — invisible everywhere, impossible to delete.
 *   - Too strict in the other: "Clear"/"Clear all" deleted the underlying extra
 *     by EXACT matchKey. So the collaterally-hidden rows were never deleted —
 *     and the moment the markers went away, every one of them FLOODED BACK onto
 *     Active. That is the "I deleted my whole list, then a day later items from
 *     old meals popped up" bug.
 *
 * The fix is to stop identifying a materialized row by its name at all. Extras
 * have stable ids; a push now records the ids it sent. Name matching survives
 * only as a fallback for markers written before this change (and for pantry
 * restock rows, which have no extra behind them).
 */
import { matchKey, looksLikeSameItem } from '@/lib/pantry';
import { isDeliberateExtra } from '@/lib/shopping';
import { isMixedUnits } from '@/lib/qty';

/** The shape of a pushed marker this module needs. */
export type PushedRef = {
  /** matchKey of the name at push time — the display/dedupe key. */
  key: string;
  name: string;
  /** Extras this push actually sent. Absent on markers written before ids. */
  extraIds?: string[];
  /** Marker also excludes by name (restock rows; legacy markers). */
  nameMatch?: true;
};

/** A marker with neither field set predates ids — keep its name behaviour. */
export const matchesByName = (p: PushedRef) =>
  p.nameMatch === true || p.extraIds === undefined;

/** What a push sends: a display name plus the extra behind it, when there is one. */
export type PushedInput = { name: string; extraId?: string | null };

/**
 * Fold a push into the marker list (upsert by matchKey).
 *
 * Two invariants worth stating, because breaking either resurrects an order:
 *  - ids ACCUMULATE. Re-pushing a name keeps the extras it already owned.
 *  - name-matching is STICKY. Once a marker excludes by name (because a row with
 *    no extra behind it went out under that name, or because it predates ids),
 *    it keeps doing so.
 */
export function upsertPushed<E extends PushedRef>(
  items: E[],
  rows: PushedInput[],
  makeEntry: (base: PushedRef) => E,
): E[] {
  const byKey = new Map(items.map((e) => [e.key, e]));
  for (const row of rows) {
    const k = matchKey(row.name);
    if (!k) continue;
    const prev = byKey.get(k);
    const ids = new Set(prev?.extraIds ?? []);
    if (row.extraId) ids.add(row.extraId);
    byKey.set(
      k,
      makeEntry({
        key: k,
        name: row.name,
        extraIds: [...ids],
        ...(prev && matchesByName(prev) ? { nameMatch: true as const } : {}),
        ...(row.extraId ? {} : { nameMatch: true as const }),
      }),
    );
  }
  return [...byKey.values()];
}

/** The shape of an extra this module needs. */
export type ExtraRef = {
  id: string;
  canonicalName: string;
  originId: string | null;
};

/**
 * Does a pushed marker cover this NAME? Only used where there is no extra to
 * key off (pantry restock rows) or for legacy markers.
 *
 * Uses `looksLikeSameItem` — the app's ONE notion of "same thing". It carries
 * the guard the old inline version was missing: a bare head-noun match only
 * counts when one of the two names is a single word ("salt" ↔ "kosher salt"),
 * so two qualified names that merely share a last word ("red onion" /
 * "green onion") are NOT the same item. It also honours pairs the user has
 * explicitly told us are different.
 */
export function isNamePushed(name: string, pushed: PushedRef[]): boolean {
  const k = matchKey(name);
  if (!k) return false;
  for (const p of pushed) {
    if (p.key === k) return true;
    if (looksLikeSameItem(name, p.name || p.key)) return true;
  }
  return false;
}

/**
 * Is THIS extra pushed?
 *
 * Id match is authoritative: a marker that knows which extras it sent can only
 * hide those extras. Nothing added afterwards is retroactively swallowed — the
 * reason a freshly-built list used to come out with items already missing.
 */
export function isExtraPushed(extra: ExtraRef, pushed: PushedRef[]): boolean {
  for (const p of pushed) {
    if (p.extraIds?.includes(extra.id)) return true;
    if (matchesByName(p) && isNamePushed(extra.canonicalName, [p])) return true;
  }
  return false;
}

/**
 * Every extra a pushed marker is responsible for — i.e. exactly the rows that
 * disappear because of it. "Clear" must delete THIS set, or whatever it misses
 * comes back the instant the marker is dropped.
 */
export function extrasForPushed<T extends ExtraRef>(entry: PushedRef, extras: T[]): T[] {
  return extras.filter((e) => isExtraPushed(e, [entry]));
}

/** Union of {@link extrasForPushed} over every marker — what "Clear all" owes. */
export function extrasForAllPushed<T extends ExtraRef>(pushed: PushedRef[], extras: T[]): T[] {
  const ids = new Set<string>();
  for (const p of pushed) for (const e of extrasForPushed(p, extras)) ids.add(e.id);
  return extras.filter((e) => ids.has(e.id));
}

export type ActiveCtx = {
  pushed: PushedRef[];
  /** matchKeys of rows in a cart-fill job that hasn't settled yet. */
  pendingKeys: Set<string>;
  /** Permanent check-off map from have.ts (exact, lowercased keys). */
  checked: Record<string, true>;
  /** Which list a hand-added row belongs to; null for rows not added by hand. */
  manualHome: (extra: ExtraRef) => 'active' | 'staples' | null;
  /**
   * Automatic "you already have this" test (always-have pin / pantry staple /
   * stock status). Only ever applied to NON-deliberate rows.
   */
  inHave: (name: string) => boolean;
};

const isChecked = (checked: Record<string, true>, name: string) =>
  checked[name.toLowerCase().trim()] === true;

/**
 * The extras that belong on Active right now, in store order.
 *
 * Deliberate rows (the plan wizard's output and anything you typed in) leave
 * only two ways: you check them off, or you push them. No automatic rule may
 * hide them. Everything else can also be routed away by the ordinary
 * have/staple logic.
 */
export function activeExtras<T extends ExtraRef>(extras: T[], ctx: ActiveCtx): T[] {
  const out: T[] = [];
  for (const ex of extras) {
    // In-flight: the cart agent is still working, so the row sits in "Pending".
    if (ctx.pendingKeys.has(matchKey(ex.canonicalName))) continue;
    if (ctx.manualHome(ex) === 'staples') continue;
    const deliberate = isDeliberateExtra(ex.originId);
    const drop = deliberate
      ? isExtraPushed(ex, ctx.pushed) || isChecked(ctx.checked, ex.canonicalName)
      : isExtraPushed(ex, ctx.pushed) || ctx.inHave(ex.canonicalName);
    if (drop) continue;
    out.push(ex);
  }
  return out;
}

/**
 * Names a fresh add must be un-hidden from. Adding something is an explicit
 * statement that you want it on the list, so every sticky exclusion that could
 * swallow it is cleared first. The wizard skipped this entirely, which is why
 * rebuilding a list could produce rows you never saw.
 *
 * Only name-matching markers can reach a brand-new row (a new extra's id is in
 * nobody's list), so those are the only ones worth dropping.
 *
 * Returns the pushed-marker KEYS to drop for `name`.
 */
export function pushedKeysCovering(name: string, pushed: PushedRef[]): string[] {
  return pushed
    .filter((p) => matchesByName(p) && isNamePushed(name, [p]))
    .map((p) => p.key);
}

/* ------------------------------------------------------------------ *
 * The build-shopping-list wizard's hand-off
 * ------------------------------------------------------------------ */

/** One finished line out of the wizard's combine step. */
export type WizardRow = { name: string; qty: string; recipes: string[] };

/** The fields the wizard writes onto an extra. */
export type WizardExtra = {
  canonicalName: string;
  amount: number | null;
  unit: string | null;
  originLabel: string;
  originId: string;
  recipes: string[];
};

export type WizardWrite<T extends ExtraRef> = {
  /** Existing wizard rows to overwrite in place, instead of duplicating. */
  updates: { extra: T; patch: WizardExtra }[];
  /** Rows not already on the list. */
  adds: WizardExtra[];
};

/**
 * Decide what a wizard run writes, given what is already on the list.
 *
 * Rebuilding for one meal used to blind-append, so every ingredient shared with
 * a meal still on the list got a second row. Matching an existing wizard row by
 * matchKey and updating it in place keeps one row per item and unions the
 * recipes it's for, so "for Ragu · Shakshuka" stays accurate.
 */
export function planWizardWrite<T extends ExtraRef & { recipes?: string[] }>(
  rows: WizardRow[],
  existing: T[],
  parseQty: (q: string) => { amount: number | null; unit: string | null },
  wizardOrigin: string,
): WizardWrite<T> {
  const liveByKey = new Map<string, T>();
  for (const e of existing) {
    if (e.originId === wizardOrigin) liveByKey.set(matchKey(e.canonicalName), e);
  }
  const out: WizardWrite<T> = { updates: [], adds: [] };
  for (const row of rows) {
    // A total the combine step could not reduce to one unit ("300 g + 1 pint")
    // must be carried as TEXT. parseQty happily returns the leading term, so
    // trusting it here quietly shipped "300 g" to the list and you bought half
    // of what the recipes needed.
    const p = isMixedUnits(row.qty)
      ? { amount: null, unit: null }
      : parseQty(row.qty);
    const hit = liveByKey.get(matchKey(row.name));
    const recipes = hit
      ? [...new Set([...(hit.recipes ?? []), ...row.recipes])]
      : row.recipes;
    const patch: WizardExtra = {
      canonicalName: row.name,
      amount: p.amount,
      // A clean single-unit total parses to amount+unit; a mixed one
      // ("300 g + 1 pint") can't, so keep the raw text rather than lose it.
      unit: p.amount != null ? p.unit : row.qty || null,
      originLabel: recipes.length ? `for ${recipes.join(' · ')}` : 'added by you',
      originId: wizardOrigin,
      recipes,
    };
    if (hit) out.updates.push({ extra: hit, patch });
    else out.adds.push(patch);
  }
  return out;
}
