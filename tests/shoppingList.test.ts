import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeExtras,
  extrasForPushed,
  extrasForAllPushed,
  isExtraPushed,
  isNamePushed,
  planWizardWrite,
  pushedKeysCovering,
  upsertPushed,
  type ExtraRef,
  type PushedRef,
  type PushedInput,
  type WizardRow,
} from '../src/lib/activeList';
import { isAlwaysHave } from '../src/lib/alwaysHave';
import { MANUAL_ACTIVE, MANUAL_STAPLE, PLAN_WIZARD } from '../src/lib/shopping';
import { parseQty } from '../src/lib/qty';
import { matchKey } from '../src/lib/pantry';

/**
 * The shopping list is the surface Nate uses most and trusts least. Its two
 * complaints are opposites of each other and had ONE cause:
 *
 *   "I add things and they don't show up"      → a pushed marker matched a row
 *   "I delete everything and it comes back"      it never sent, by loose name.
 *
 * These tests drive the real row rules (src/lib/activeList.ts) through a small
 * simulator that mirrors the shopping screen's handlers one-for-one, so a
 * regression here means a regression in the app.
 */

/* ------------------------------------------------------------------ *
 * Simulator — mirrors shopping.tsx / build-list.tsx handler for handler
 * ------------------------------------------------------------------ */

type Extra = ExtraRef & { recipes?: string[]; qty?: string };
type Pushed = PushedRef & { dest: string };

class Kitchen {
  extras: Extra[] = [];
  pushed: Pushed[] = [];
  /** have.ts `checked` — permanent check-off, exact lowercase keys. */
  checked: Record<string, true> = {};
  /** have.ts `alwaysHave` pins. */
  alwaysHave: Record<string, true> = {};
  /** Pantry staple names. */
  staples: string[] = [];
  pending = new Set<string>();
  private seq = 0;

  private id() {
    return `extra_${++this.seq}`;
  }

  /** shopping.tsx `manualHome`. */
  private manualHome = (ex: ExtraRef): 'active' | 'staples' | null => {
    if (ex.originId === MANUAL_STAPLE) return 'staples';
    if (ex.originId === MANUAL_ACTIVE) return 'active';
    if (ex.originId == null)
      return isAlwaysHave(ex.canonicalName, this.alwaysHave) ? 'staples' : 'active';
    return null;
  };

  /** shopping.tsx `inHave` (staple pin / pantry staple / check-off). */
  private inHave = (name: string): boolean => {
    if (isAlwaysHave(name, this.alwaysHave)) return true;
    if (this.staples.some((s) => matchKey(s) === matchKey(name))) return true;
    return this.checked[name.toLowerCase().trim()] === true;
  };

  /** What the Active list shows right now. */
  active(): string[] {
    return activeExtras(this.extras, {
      pushed: this.pushed,
      pendingKeys: this.pending,
      checked: this.checked,
      manualHome: this.manualHome,
      inHave: this.inHave,
    }).map((e) => e.canonicalName);
  }

  /** build-list.tsx `finish()`: un-hide, then update-or-add. */
  runWizard(rows: WizardRow[]) {
    for (const r of rows) {
      delete this.checked[r.name.toLowerCase().trim()];
      for (const key of pushedKeysCovering(r.name, this.pushed)) this.restorePushed(key);
    }
    const write = planWizardWrite(rows, this.extras, parseQty, PLAN_WIZARD);
    for (const u of write.updates) {
      Object.assign(u.extra, u.patch);
    }
    for (const a of write.adds) this.extras.push({ ...a, id: this.id() });
    return write;
  }

  /** shopping.tsx `submitAdd()`. */
  addManual(name: string) {
    delete this.checked[name.toLowerCase().trim()];
    for (const key of pushedKeysCovering(name, this.pushed)) this.restorePushed(key);
    this.extras.push({
      id: this.id(),
      canonicalName: name,
      originId: MANUAL_ACTIVE,
    });
  }

  /** shopping.tsx `pushRefs()` + usePushedStore.push(). */
  push(rows: PushedInput[], dest = 'wegmans') {
    this.pushed = upsertPushed(this.pushed, rows, (base) => ({ ...base, dest }));
  }

  /** Push every row currently on Active, the way "select all → Wegmans" does. */
  pushAllActive(dest = 'wegmans') {
    const rows = activeExtras(this.extras, {
      pushed: this.pushed,
      pendingKeys: this.pending,
      checked: this.checked,
      manualHome: this.manualHome,
      inHave: this.inHave,
    }).map((e) => ({ name: e.canonicalName, extraId: e.id }));
    this.push(rows, dest);
    return rows.length;
  }

  restorePushed(key: string) {
    this.pushed = this.pushed.filter((p) => p.key !== key);
  }

  /** shopping.tsx `deletePushedItem()`. */
  clearPushedItem(key: string) {
    const entry = this.pushed.find((p) => p.key === key);
    if (entry) {
      const doomed = new Set(extrasForPushed(entry, this.extras).map((e) => e.id));
      this.extras = this.extras.filter((e) => !doomed.has(e.id));
    }
    this.restorePushed(key);
  }

  /** shopping.tsx `clearAllPushed()`. */
  clearAllPushed() {
    const doomed = new Set(extrasForAllPushed(this.pushed, this.extras).map((e) => e.id));
    this.extras = this.extras.filter((e) => !doomed.has(e.id));
    this.pushed = [];
  }

  /** shopping.tsx `deleteRow()` for an extra. */
  deleteByName(name: string) {
    this.extras = this.extras.filter((e) => matchKey(e.canonicalName) !== matchKey(name));
  }

  /** Swipe-right check-off. */
  checkOff(name: string) {
    this.checked[name.toLowerCase().trim()] = true;
  }
}

const wizardRow = (name: string, qty: string, recipes: string[]): WizardRow => ({
  name,
  qty,
  recipes,
});

/* ------------------------------------------------------------------ *
 * The reported bug, end to end
 * ------------------------------------------------------------------ */

describe("Nate's report: old meals reappear after a rebuild", () => {
  // Three meals. Meal 1 and 2 each bring an ingredient whose LAST WORD collides
  // with something in meal 3 — which is all the old matcher needed to declare
  // them the same item.
  const MEAL_1 = [
    wizardRow('green onions', '1 bunch', ['Ramen']),
    wizardRow('sesame oil', '2 tbsp', ['Ramen']),
    wizardRow('pork belly', '1 lb', ['Ramen']),
  ];
  const MEAL_2 = [
    wizardRow('chicken broth', '4 cup', ['Tortilla soup']),
    wizardRow('black beans', '2 can', ['Tortilla soup']),
    wizardRow('lime', '3', ['Tortilla soup']),
  ];
  const MEAL_3 = [
    wizardRow('red onions', '2', ['Shakshuka']),
    wizardRow('olive oil', '3 tbsp', ['Shakshuka']),
    wizardRow('feta', '4 oz', ['Shakshuka']),
  ];

  let k: Kitchen;
  beforeEach(() => {
    k = new Kitchen();
  });

  it('builds a list for three meals with every item on it', () => {
    k.runWizard([...MEAL_1, ...MEAL_2, ...MEAL_3]);
    expect(k.active()).toHaveLength(9);
    expect(k.active()).toContain('red onions');
    expect(k.active()).toContain('green onions');
  });

  it('does not hide unrelated items when the cart push goes out', () => {
    k.runWizard([...MEAL_1, ...MEAL_2, ...MEAL_3]);
    // Push ONLY meal 1. Nothing from meals 2 or 3 may leave the list.
    k.push(
      MEAL_1.map((r) => ({
        name: r.name,
        extraId: k.extras.find((e) => e.canonicalName === r.name)!.id,
      })),
    );
    const left = k.active();
    expect(left).toHaveLength(6);
    // These are the ones the old head-noun match swallowed.
    expect(left).toContain('red onions'); // vs pushed "green onions"
    expect(left).toContain('olive oil'); // vs pushed "sesame oil"
  });

  it('clears the whole list for good — a rebuild brings back ONLY the new meal', () => {
    // 1. Groceries for three meals.
    k.runWizard([...MEAL_1, ...MEAL_2, ...MEAL_3]);
    expect(k.active()).toHaveLength(9);

    // 2. Push to Wegmans. The list empties into Pushed.
    expect(k.pushAllActive()).toBe(9);
    expect(k.active()).toEqual([]);

    // 3. Delete them.
    k.clearAllPushed();
    expect(k.extras).toEqual([]);

    // 4. A day later, rebuild for meal 3 only.
    k.runWizard(MEAL_3);

    // 5. Meal 3, and nothing else. This assertion is the bug report.
    expect(k.active().sort()).toEqual(['feta', 'olive oil', 'red onions']);
  });

  it('rebuilds a partially-shopped list without duplicating or losing rows', () => {
    k.runWizard([...MEAL_1, ...MEAL_2, ...MEAL_3]);
    // Only some of the order made it into the cart.
    k.push([
      { name: 'lime', extraId: k.extras.find((e) => e.canonicalName === 'lime')!.id },
      { name: 'feta', extraId: k.extras.find((e) => e.canonicalName === 'feta')!.id },
    ]);
    k.clearAllPushed();

    // Re-running the wizard for meal 3 re-adds the feta you already bought (it
    // is back in the plan) and leaves the other two meal-3 rows as single rows.
    k.runWizard(MEAL_3);
    const active = k.active();
    expect(active.filter((n) => n === 'red onions')).toHaveLength(1);
    expect(active.filter((n) => n === 'olive oil')).toHaveLength(1);
    expect(active).toContain('feta');
    // Meal 1 / 2 survivors are still there — they were never pushed or deleted.
    expect(active).toContain('pork belly');
    expect(active).not.toContain('lime');
  });
});

/* ------------------------------------------------------------------ *
 * Pushed markers: hide exactly what went out, nothing more
 * ------------------------------------------------------------------ */

describe('pushed markers', () => {
  let k: Kitchen;
  beforeEach(() => {
    k = new Kitchen();
  });

  it('hides only the extras it sent, not same-head-noun neighbours', () => {
    k.runWizard([
      wizardRow('green onions', '1 bunch', ['A']),
      wizardRow('red onions', '2', ['B']),
    ]);
    const green = k.extras.find((e) => e.canonicalName === 'green onions')!;
    k.push([{ name: 'green onions', extraId: green.id }]);
    expect(k.active()).toEqual(['red onions']);
  });

  it('never swallows a row created AFTER the push', () => {
    k.runWizard([wizardRow('shallots', '3', ['A'])]);
    const shallots = k.extras.find((e) => e.canonicalName === 'shallots')!;
    k.push([{ name: 'shallots', extraId: shallots.id }]);
    expect(k.active()).toEqual([]);
    // Same name, new row: it is a new intention to buy, so it shows.
    k.addManual('shallots');
    expect(k.active()).toEqual(['shallots']);
  });

  it('deletes EVERY row a marker is hiding, including duplicates', () => {
    // Two rows that normalize to the same key — a wizard row and a manual add.
    k.runWizard([wizardRow('butter', '1 stick', ['A'])]);
    k.addManual('Butter');
    expect(k.active()).toHaveLength(2);
    k.pushAllActive();
    expect(k.active()).toEqual([]);
    k.clearAllPushed();
    // Neither may come back.
    expect(k.extras).toEqual([]);
    expect(k.active()).toEqual([]);
  });

  it('clearing one marker does not resurrect a different item', () => {
    k.runWizard([
      wizardRow('green onions', '1 bunch', ['A']),
      wizardRow('red onions', '2', ['B']),
    ]);
    const ids = Object.fromEntries(k.extras.map((e) => [e.canonicalName, e.id]));
    k.push([
      { name: 'green onions', extraId: ids['green onions'] },
      { name: 'red onions', extraId: ids['red onions'] },
    ]);
    k.clearPushedItem(matchKey('green onions'));
    // Red onions were pushed too and stay pushed — clearing green must not
    // drop them back onto Active, and must not delete them either.
    expect(k.active()).toEqual([]);
    expect(k.extras.map((e) => e.canonicalName)).toEqual(['red onions']);
  });

  it('carries every member of a merged row, so none is left behind', () => {
    // "shallot" and "shallots" are folded into one visible row; the push records
    // the merged row's name but must own BOTH extras.
    k.runWizard([wizardRow('shallot', '2', ['A']), wizardRow('shallots', '3', ['B'])]);
    const members = k.extras.map((e) => ({ name: 'shallots', extraId: e.id }));
    k.push(members);
    expect(k.active()).toEqual([]);
    k.clearAllPushed();
    expect(k.extras).toEqual([]);
  });

  it('accumulates ids when the same name is pushed twice', () => {
    k.runWizard([wizardRow('eggs', '1 dozen', ['A'])]);
    const first = k.extras[0]!.id;
    k.push([{ name: 'eggs', extraId: first }]);
    k.addManual('eggs');
    const second = k.extras.find((e) => e.id !== first)!.id;
    k.push([{ name: 'eggs', extraId: second }]);
    expect(k.pushed).toHaveLength(1);
    expect(k.pushed[0]!.extraIds!.sort()).toEqual([first, second].sort());
    // Re-pushing must not have released the first one back onto the list.
    expect(k.active()).toEqual([]);
  });

  it('keeps name-matching for a row with no extra behind it (pantry restock)', () => {
    // A restock line has no id, so the marker has to fall back to the name.
    const pushed = upsertPushed<Pushed>([], [{ name: 'paprika' }], (b) => ({
      ...b,
      dest: 'wegmans',
    }));
    expect(pushed[0]!.nameMatch).toBe(true);
    expect(isNamePushed('paprika', pushed)).toBe(true);
  });

  it('honours markers written before ids existed', () => {
    const legacyMarker: PushedRef = { key: 'oat milk', name: 'oat milk' };
    const ex: ExtraRef = { id: 'x1', canonicalName: 'oat milk', originId: PLAN_WIZARD };
    expect(isExtraPushed(ex, [legacyMarker])).toBe(true);
    // And "Clear" on it still deletes the row it is hiding.
    expect(extrasForPushed(legacyMarker, [ex])).toHaveLength(1);
  });

  it('a legacy marker does not block a fresh add of the same name', () => {
    const k2 = new Kitchen();
    k2.pushed = [{ key: 'oat milk', name: 'oat milk', dest: 'wegmans' }];
    k2.addManual('oat milk');
    expect(k2.active()).toEqual(['oat milk']);
  });
});

/* ------------------------------------------------------------------ *
 * Deliberate rows: nothing automatic may hide them
 * ------------------------------------------------------------------ */

describe('deliberate rows', () => {
  let k: Kitchen;
  beforeEach(() => {
    k = new Kitchen();
  });

  it('keeps a wizard row on Active even when the item is a pantry staple', () => {
    k.staples = ['olive oil'];
    k.alwaysHave = { 'olive oil': true };
    k.runWizard([wizardRow('olive oil', '1 bottle', ['A'])]);
    expect(k.active()).toEqual(['olive oil']);
  });

  it('keeps a manual add on Active despite an old permanent check-off', () => {
    k.checked['pine nuts'] = true;
    k.addManual('pine nuts');
    expect(k.active()).toEqual(['pine nuts']);
  });

  it('drops a wizard row once you check it off', () => {
    k.runWizard([wizardRow('feta', '4 oz', ['A'])]);
    k.checkOff('feta');
    expect(k.active()).toEqual([]);
  });

  it('routes a non-deliberate row (pipeline idea) by the have rules', () => {
    k.extras.push({ id: 'p1', canonicalName: 'saffron', originId: 'idea_123' });
    expect(k.active()).toEqual(['saffron']);
    k.alwaysHave = { saffron: true };
    expect(k.active()).toEqual([]);
  });

  it('holds in-flight rows out of Active while the cart agent works', () => {
    k.runWizard([wizardRow('feta', '4 oz', ['A'])]);
    k.pending = new Set([matchKey('feta')]);
    expect(k.active()).toEqual([]);
    k.pending = new Set();
    expect(k.active()).toEqual(['feta']);
  });
});

/* ------------------------------------------------------------------ *
 * The wizard hand-off
 * ------------------------------------------------------------------ */

describe('plan wizard hand-off', () => {
  it('updates an existing row instead of adding a second one', () => {
    const existing: Extra[] = [
      { id: 'e1', canonicalName: 'olive oil', originId: PLAN_WIZARD, recipes: ['Ragu'] },
    ];
    const w = planWizardWrite(
      [wizardRow('olive oil', '3 tbsp', ['Shakshuka'])],
      existing,
      parseQty,
      PLAN_WIZARD,
    );
    expect(w.adds).toHaveLength(0);
    expect(w.updates).toHaveLength(1);
    // The row is now for BOTH recipes.
    expect(w.updates[0]!.patch.recipes).toEqual(['Ragu', 'Shakshuka']);
    expect(w.updates[0]!.patch.originLabel).toBe('for Ragu · Shakshuka');
  });

  it('does not fold into a MANUAL row — that is yours, keep it separate', () => {
    const existing: Extra[] = [
      { id: 'e1', canonicalName: 'olive oil', originId: MANUAL_ACTIVE },
    ];
    const w = planWizardWrite(
      [wizardRow('olive oil', '3 tbsp', ['Shakshuka'])],
      existing,
      parseQty,
      PLAN_WIZARD,
    );
    expect(w.updates).toHaveLength(0);
    expect(w.adds).toHaveLength(1);
  });

  it('keeps a mixed-unit total as text rather than dropping it', () => {
    const w = planWizardWrite(
      [wizardRow('tomatoes', '300 g + 1 pint', ['A'])],
      [],
      parseQty,
      PLAN_WIZARD,
    );
    expect(w.adds[0]!.amount).toBeNull();
    expect(w.adds[0]!.unit).toBe('300 g + 1 pint');
  });

  it('un-hides a name a previous order had marked pushed', () => {
    const k = new Kitchen();
    k.runWizard([wizardRow('feta', '4 oz', ['A'])]);
    k.pushAllActive();
    k.clearAllPushed();
    // A legacy-style marker left over from before ids, for the same name.
    k.pushed = [{ key: 'feta', name: 'feta', dest: 'wegmans' }];
    k.runWizard([wizardRow('feta', '4 oz', ['B'])]);
    expect(k.active()).toEqual(['feta']);
  });

  it('is idempotent — running the same build twice changes nothing', () => {
    const k = new Kitchen();
    const rows = [wizardRow('feta', '4 oz', ['A']), wizardRow('red onions', '2', ['A'])];
    k.runWizard(rows);
    const first = k.active().sort();
    k.runWizard(rows);
    expect(k.active().sort()).toEqual(first);
    expect(k.extras).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * The name matcher itself
 * ------------------------------------------------------------------ */

describe('name matching (fallback path only)', () => {
  const mark = (name: string): PushedRef => ({ key: matchKey(name), name });

  it('matches plural / prefix variants of one word', () => {
    expect(isNamePushed('shallots', [mark('shallot')])).toBe(true);
    expect(isNamePushed('basil', [mark('basil leaves')])).toBe(true);
  });

  it('matches a bare head noun against a qualified name', () => {
    expect(isNamePushed('kosher salt', [mark('salt')])).toBe(true);
  });

  it('does NOT match two qualified names that merely share a last word', () => {
    for (const [a, b] of [
      ['red onions', 'green onions'],
      ['olive oil', 'sesame oil'],
      ['chicken broth', 'vegetable broth'],
      ['heavy cream', 'sour cream'],
      ['black beans', 'green beans'],
      ['white rice', 'brown rice'],
    ] as const) {
      expect(isNamePushed(a, [mark(b)]), `${a} vs ${b}`).toBe(false);
    }
  });

  it('applies the same guard to always-have pins', () => {
    expect(isAlwaysHave('kosher salt', { salt: true })).toBe(true);
    expect(isAlwaysHave('sesame oil', { 'olive oil': true })).toBe(false);
    expect(isAlwaysHave('red onions', { 'green onions': true })).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Invariants — hold for any sequence of operations
 * ------------------------------------------------------------------ */

describe('invariants', () => {
  const NAMES = [
    'red onions',
    'green onions',
    'olive oil',
    'sesame oil',
    'feta',
    'lime',
    'chicken broth',
    'black beans',
  ];

  /** Deterministic pseudo-random so a failure is reproducible. */
  const rng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  it('nothing ever appears on Active that was not explicitly added', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      const k = new Kitchen();
      const everAdded = new Set<string>();
      for (let step = 0; step < 30; step++) {
        const name = NAMES[Math.floor(rand() * NAMES.length)]!;
        const op = Math.floor(rand() * 5);
        if (op === 0) {
          k.runWizard([wizardRow(name, '1', ['R'])]);
          everAdded.add(matchKey(name));
        } else if (op === 1) {
          k.addManual(name);
          everAdded.add(matchKey(name));
        } else if (op === 2) {
          k.pushAllActive();
        } else if (op === 3) {
          k.clearAllPushed();
        } else {
          k.deleteByName(name);
        }
        for (const shown of k.active()) {
          expect(everAdded.has(matchKey(shown)), `seed ${seed} step ${step}: ${shown}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('push then clear-all always empties the list completely', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      const k = new Kitchen();
      for (let i = 0; i < 6; i++) {
        const name = NAMES[Math.floor(rand() * NAMES.length)]!;
        if (rand() < 0.5) k.runWizard([wizardRow(name, '1', ['R'])]);
        else k.addManual(name);
      }
      k.pushAllActive();
      k.clearAllPushed();
      expect(k.active(), `seed ${seed}`).toEqual([]);
      // And they are genuinely gone, not merely hidden — so no later state
      // change can bring them back.
      expect(k.extras, `seed ${seed}`).toEqual([]);
    }
  });

  it('a row is only ever hidden by a marker that owns it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      const k = new Kitchen();
      for (let i = 0; i < 8; i++) {
        k.addManual(NAMES[Math.floor(rand() * NAMES.length)]!);
      }
      // Push a random subset by id.
      const subset = k.extras.filter(() => rand() < 0.5);
      k.push(subset.map((e) => ({ name: e.canonicalName, extraId: e.id })));
      const pushedIds = new Set(subset.map((e) => e.id));
      const hidden = k.extras.filter((e) => !k.active().includes(e.canonicalName));
      for (const h of hidden) {
        // Every hidden row must be one we pushed, or share a name with one
        // (duplicates collapse under a single marker key).
        const sameName = subset.some(
          (s) => matchKey(s.canonicalName) === matchKey(h.canonicalName),
        );
        expect(pushedIds.has(h.id) || sameName, `seed ${seed}: ${h.canonicalName}`).toBe(
          true,
        );
      }
    }
  });
});
