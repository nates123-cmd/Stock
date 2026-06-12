/**
 * Must-priority story logic coverage — maps to stock-user-stories.html.
 * Each describe() block is one Must story whose acceptance criteria are pure
 * logic (no DOM, no Claude). Flow/visual criteria for the same stories are
 * covered by Playwright / manual passes, not here. Imports the REAL shipped
 * modules from src/ via the @ alias (vitest.config.ts).
 */
import { describe, it, expect } from 'vitest';
import type { Recipe, PantryItem } from '@/types';
import {
  consolidateLocalSmart,
  categorizeIngredient,
  CATEGORY_ORDER,
  instacartText,
} from '@/lib/shopping';
import {
  startOfWeek,
  weekDays,
  isPastWeek,
  addWeeks,
} from '@/lib/week';
import {
  coverageSet,
  hasInPantry,
  recipeCoverage,
  canMakeNow,
  matchKey,
  baseIngredient,
  cycleEstimateDays,
  isCycleStable,
} from '@/lib/pantry';
import { isModified, modCount } from '@/lib/recipe';
import { durationToSeconds, tokenizeStep } from '@/lib/cookText';
import fs from 'node:fs';
import path from 'node:path';

/* ---- minimal real-shape builders (mirrors recipe.test.ts style) ---- */
const ing = (canonicalName: string, amount: number | null = 1, unit: string | null = null, originalText?: string) =>
  ({ canonicalName, amount, unit, originalText, modificationHistory: [] }) as any;
const recipe = (title: string, names: string[]): Recipe =>
  ({ title, ingredients: names.map((n) => ing(n)), steps: [] }) as any;
const pantry = (...names: string[]): PantryItem[] =>
  names.map((canonicalName) => ({ canonicalName }) as PantryItem);

/* ================================================================== */
/* PLAN-01 · week shows Sun–Sat, past weeks read-only                  */
/* ================================================================== */
describe('PLAN-01 · week ordering & past-week flag', () => {
  it('a week starts on Sunday', () => {
    // Wed 2026-06-10 → week starts Sun 2026-06-07
    const start = startOfWeek(new Date(2026, 5, 10));
    expect(start.getDay()).toBe(0);
    expect(start.getDate()).toBe(7);
  });
  it('a week has 7 days', () => {
    expect(weekDays(startOfWeek(new Date(2026, 5, 10)))).toHaveLength(7);
  });
  it('last week is flagged past, this week is not', () => {
    const today = new Date(2026, 5, 10);
    const thisWeek = startOfWeek(today);
    expect(isPastWeek(thisWeek, today)).toBe(false);
    expect(isPastWeek(addWeeks(thisWeek, -1), today)).toBe(true);
  });
});

/* ================================================================== */
/* PLAN-08 · shopping list categorizes ingredients                     */
/* ================================================================== */
describe('PLAN-08 · ingredient categorization', () => {
  it('routes staples to the right aisle', () => {
    expect(categorizeIngredient('lemon')).toBe('produce');
    expect(categorizeIngredient('chicken thigh')).toBe('meat');
    expect(categorizeIngredient('whole milk')).toBe('dairy');
    expect(categorizeIngredient('bread flour')).toBe('bakery');
    expect(categorizeIngredient('olive oil')).toBe('pantry');
  });
  it('falls back to "other" for the unknown', () => {
    expect(categorizeIngredient('dragonfruit powder')).toBe('other');
  });
  it('category order is the spec aisle order', () => {
    expect(CATEGORY_ORDER[0]).toBe('produce');
    expect(CATEGORY_ORDER[CATEGORY_ORDER.length - 1]).toBe('other');
  });
});

/* ================================================================== */
/* PLAN-13 · grade-qualifier folding (Should, but core to PLAN-08)     */
/* ================================================================== */
describe('PLAN-13 · grade-qualifier folding', () => {
  it('folds salt variants into one buy line', () => {
    const lines = consolidateLocalSmart([
      recipe('Brine', ['kosher salt']),
      recipe('Focaccia', ['sea salt']),
    ]);
    const salt = lines.filter((l) => /salt/.test(l.name));
    expect(salt).toHaveLength(1);
  });
  it('folds EVOO and olive oil together', () => {
    const lines = consolidateLocalSmart([
      recipe('Dressing', ['extra-virgin olive oil']),
      recipe('Saute', ['olive oil']),
    ]);
    expect(lines.filter((l) => /olive oil/.test(l.name))).toHaveLength(1);
  });
  it('keeps brown sugar distinct from sugar', () => {
    const lines = consolidateLocalSmart([
      recipe('Cookies', ['brown sugar']),
      recipe('Meringue', ['sugar']),
    ]);
    const sugar = lines.filter((l) => /sugar/.test(l.name)).map((l) => l.name);
    expect(sugar).toHaveLength(2);
  });
});

/* ================================================================== */
/* PLAN-15 · copy-for-Instacart text format                            */
/* ================================================================== */
describe('PLAN-15 · Instacart copy text', () => {
  it('emits one line per item', () => {
    const lines = consolidateLocalSmart([
      recipe('Salad', ['lemon', 'cucumber']),
    ]);
    const txt = instacartText(lines);
    expect(txt.split('\n').filter(Boolean).length).toBe(lines.length);
    expect(txt.length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* PLAN-09 · pantry subtracted from the buy list ("have it")           */
/* ================================================================== */
describe('PLAN-09 / PANT-10 · pantry coverage', () => {
  it('matchKey drops the qualifier after the comma', () => {
    expect(matchKey('olive oil, EVOO')).toBe('olive oil');
  });
  it('tolerates singular/plural (lemon vs lemons)', () => {
    const have = coverageSet(pantry('lemons'));
    expect(hasInPantry('lemon', have)).toBe(true);
  });
  it('counts covered vs missing', () => {
    const cov = recipeCoverage(
      [ing('lemon'), ing('olive oil'), ing('saffron')],
      pantry('lemons', 'olive oil'),
    );
    expect(cov.have).toBe(2);
    expect(cov.missing).toEqual(['saffron']);
  });
  it('canMakeNow when at most one item is missing', () => {
    expect(canMakeNow({ have: 4, total: 5, missing: ['x'] })).toBe(true);
    expect(canMakeNow({ have: 3, total: 5, missing: ['x', 'y'] })).toBe(false);
  });
  it('baseIngredient reduces a staple to its head noun', () => {
    expect(baseIngredient('fine sea salt')).toBe('salt');
  });
});

/* ================================================================== */
/* PANT-08 · cycle learning (avg gap + stability)                      */
/* ================================================================== */
describe('PANT-08 · purchase-cycle learning', () => {
  const d = (iso: string) => new Date(iso);
  it('needs 3+ purchases (2 gaps) before estimating', () => {
    expect(cycleEstimateDays([d('2026-01-01')])).toBeUndefined();
    expect(cycleEstimateDays([d('2026-01-01'), d('2026-01-08')])).toBeUndefined();
  });
  it('averages the gaps once there are enough', () => {
    const est = cycleEstimateDays([d('2026-01-01'), d('2026-01-08'), d('2026-01-15')]);
    expect(est).toBe(7);
  });
  it('marks a cycle stable only within ±20%', () => {
    const steady = [d('2026-01-01'), d('2026-01-08'), d('2026-01-15'), d('2026-01-22')];
    expect(isCycleStable(steady)).toBe(true);
    const erratic = [d('2026-01-01'), d('2026-01-03'), d('2026-01-20'), d('2026-01-22')];
    expect(isCycleStable(erratic)).toBe(false);
  });
});

/* ================================================================== */
/* CAP-09 · modified recipes are detectable (drives the annotation)    */
/* ================================================================== */
describe('CAP-09 · modification detection', () => {
  const modIng = (canonicalName: string, hist: any[]) =>
    ({ canonicalName, amount: 1, unit: null, modificationHistory: hist }) as any;
  it('a recipe with no mods reads unmodified', () => {
    expect(isModified(recipe('Plain', ['egg']))).toBe(false);
  });
  it('a recipe with an ingredient mod reads modified', () => {
    const r = { title: 'Tweaked', ingredients: [modIng('flour', [{ type: 'amount', before: 150, after: 200, date: new Date() }])], steps: [] } as any;
    expect(isModified(r)).toBe(true);
    expect(modCount(r)).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== */
/* COOK-02/04 · step text → timers & segments (cook-mode parsing)      */
/* ================================================================== */
describe('COOK · step text parsing', () => {
  it('parses durations to seconds', () => {
    expect(durationToSeconds('90 seconds')).toBe(90);
    expect(durationToSeconds('2 minutes')).toBe(120);
    expect(durationToSeconds('1 hour')).toBe(3600);
  });
  it('tokenizes a step into segments (timer detected)', () => {
    const segs = tokenizeStep('Bake for 25 minutes until golden.');
    expect(Array.isArray(segs)).toBe(true);
    expect(segs.some((s: any) => s.type === 'timer')).toBe(true);
  });
});

/* ================================================================== */
/* SYS-06 · no emojis in the source (design-system guard)              */
/* ================================================================== */
describe('SYS-06 · no emoji in shipped source', () => {
  // Astral-plane emoji only — the app's glyph vocabulary (▤ ◔ ⚖ ▣ ◷ ✓ ✕) lives
  // in BMP symbol ranges (⚖ is U+2696, in Misc-Symbols) and is allowed by spec
  // §2. Real "emoji-as-icon" violations are the pictographic astral block.
  const EMOJI = /[\u{1F000}-\u{1FAFF}]/u;
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
  it('no .ts/.tsx file under src/ contains an emoji glyph', () => {
    const root = path.resolve(__dirname, '..', 'src');
    const offenders: string[] = [];
    for (const f of walk(root)) {
      const txt = fs.readFileSync(f, 'utf8');
      if (EMOJI.test(txt)) offenders.push(path.relative(root, f));
    }
    expect(offenders).toEqual([]);
  });
});
