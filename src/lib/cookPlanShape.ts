/**
 * Cook-plan SHAPE helpers — the pure translation from a flat combined timeline
 * (what `combineMeal` returns) into the phased `CookPlan` structure the cook
 * screens and `planSchedule.ts` consume.
 *
 * Deliberately split from `dinnerToCookPlan.ts`, which does the async build:
 * everything here is side-effect free and imports only TYPES, so it unit-tests
 * directly — the same reason `planSchedule.ts` is its own module. (It is also
 * the only way to test it at all: `combineMeal` reaches `lib/api/cache`, whose
 * `typeof import()` trips vite's SSR parser in the test harness.)
 */
import { uid } from '@/lib/id';
import type { CombinedStep } from '@/lib/combineMeal';
import type { PlanComponent, PlanPhase, PlanStep, PlanTimer, Recipe } from '@/types';

/**
 * Phase buckets, coarsest first. `minHours` is the *lower* edge of the
 * hours-before-serve window, matching PlanPhase.offsetFromServe semantics
 * (earliest start = serve − maxHours, latest = serve − minHours).
 */
const BUCKETS: { label: string; from: number; to: number }[] = [
  { label: 'Days ahead', from: 24, to: Infinity },
  { label: 'The day before', from: 8, to: 24 },
  { label: 'Earlier in the day', from: 2, to: 8 },
  { label: 'Final stretch', from: 0.25, to: 2 },
  { label: 'Plate and serve', from: 0, to: 0.25 },
];

/**
 * Parse a relative offset label into hours-before-serve.
 * "T-24h" → 24, "T-45m" → 0.75, "T-1h30m" → 1.5, "T-0" / "" → 0.
 * Returns undefined only when there is no parseable number at all, so the
 * caller can tell "serve time" apart from "the offline fallback gave us
 * nothing" and skip scheduling entirely.
 */
export function parseOffsetHours(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const s = label.trim().toLowerCase();
  if (!s) return undefined;
  if (/^t-?0\b/.test(s) || s === 't' || s === 't-0') return 0;

  // Scan every number+unit token rather than matching each unit once, so the
  // compound forms ("T-1h30m", "T-2d12h") add up instead of the later unit
  // winning. A trailing word boundary would break exactly those: in "1h30m"
  // the "h" is followed by a digit, so there is no boundary to match.
  const PER_HOUR: Record<string, number> = { d: 24, h: 1, m: 1 / 60 };
  let hours = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([dhm])/g)) {
    const per = PER_HOUR[m[2] ?? ''];
    if (per == null) continue;
    hours += parseFloat(m[1] ?? '0') * per;
    matched = true;
  }
  if (matched) return hours;

  // Bare "T-90" — no unit. Claude is told to label in h/m, so a naked number
  // is most likely minutes.
  const bare = s.match(/(\d+(?:\.\d+)?)/);
  return bare?.[1] ? parseFloat(bare[1]) / 60 : undefined;
}

/** Anything at or past the serve moment lands here. */
const SERVE_BUCKET = { label: 'Plate and serve', from: 0, to: 0.25 };

/** Which bucket an offset falls in. Largest offset = earliest work. */
function bucketFor(hours: number): { label: string; from: number; to: number } {
  return BUCKETS.find((b) => hours >= b.from && hours < b.to) ?? SERVE_BUCKET;
}

/**
 * Best-effort timer off a step's own words, so the generated plan can actually
 * ring during a live cook. Conservative on purpose: only an explicit duration
 * ("simmer for 20 minutes", "rest 1 hour") becomes a timer. An oven temp
 * becomes a display-only temp chip.
 */
export function timerFromText(text: string): PlanTimer | undefined {
  const dur = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(hour|hr|minute|min)s?\b/i);
  if (dur?.[1] && dur[3]) {
    const unit = dur[3].toLowerCase();
    const perUnit = unit.startsWith('h') ? 3600 : 60;
    const low = parseFloat(dur[1]) * perUnit;
    const high = dur[2] ? parseFloat(dur[2]) * perUnit : undefined;
    if (high && high > low) {
      return { kind: 'clock', label: 'Window', minSeconds: low, maxSeconds: high };
    }
    return { kind: 'duration', label: 'Timer', seconds: low };
  }
  const temp = text.match(/(\d{2,3})\s*(?:-|–|to)?\s*(\d{2,3})?\s*°?\s*F\b/i);
  if (temp?.[1]) {
    const lowF = parseInt(temp[1], 10);
    const highF = temp[2] ? parseInt(temp[2], 10) : undefined;
    if (lowF >= 100 && lowF <= 600) {
      return {
        kind: 'temp',
        label: 'Temp',
        tempF: lowF,
        ...(highF && highF > lowF ? { tempHighF: highF } : {}),
      };
    }
  }
  return undefined;
}

/** Map a dish title back to the component built from that recipe. */
function componentIdByTitle(components: PlanComponent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of components) m.set(c.name.trim().toLowerCase(), c.id);
  return m;
}

/**
 * Group a flat combined timeline into phases.
 *
 * Two modes, decided by the data rather than a flag:
 *  - **Scheduled** — the steps carry parseable offsets (Claude path). Steps are
 *    ordered earliest-first and bucketed, and each phase gets the real
 *    hours-before-serve window spanned by its steps.
 *  - **Sequential** — no offsets survived (the offline fallback, which just
 *    concatenates each dish's steps). Then we phase BY DISH instead of
 *    inventing times, and leave `offsetFromServe` off so nothing pretends to
 *    be scheduled.
 */
export function phasesFromCombined(
  steps: CombinedStep[],
  components: PlanComponent[],
): PlanPhase[] {
  const byTitle = componentIdByTitle(components);
  const withHours = steps.map((s) => ({ step: s, hours: parseOffsetHours(s.offsetLabel) }));
  const scheduled = withHours.some((w) => w.hours != null);

  const makeStep = (s: CombinedStep, ordinal: number): PlanStep => {
    const timer = timerFromText(s.text);
    const componentId = s.dish ? byTitle.get(s.dish.trim().toLowerCase()) : undefined;
    return {
      id: uid('pstep'),
      ordinal,
      text: s.text,
      ...(componentId ? { componentId } : {}),
      ...(timer ? { timer } : {}),
    };
  };

  if (!scheduled) {
    // Fallback: one phase per dish, in the order they were handed over.
    const order: string[] = [];
    const groups = new Map<string, CombinedStep[]>();
    for (const s of steps) {
      const key = s.dish?.trim() || 'Everything else';
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(s);
    }
    return order.map((label) => ({
      id: uid('phase'),
      label,
      steps: (groups.get(label) ?? []).map((s, i) => makeStep(s, i + 1)),
    }));
  }

  // Scheduled: earliest (largest hours-before-serve) first.
  const sorted = [...withHours].sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));
  const phases: PlanPhase[] = [];
  const index = new Map<string, { phase: PlanPhase; min: number; max: number }>();
  for (const { step, hours } of sorted) {
    const h = hours ?? 0;
    const bucket = bucketFor(h);
    let entry = index.get(bucket.label);
    if (!entry) {
      const phase: PlanPhase = { id: uid('phase'), label: bucket.label, steps: [] };
      entry = { phase, min: h, max: h };
      index.set(bucket.label, entry);
      phases.push(phase);
    }
    entry.min = Math.min(entry.min, h);
    entry.max = Math.max(entry.max, h);
    entry.phase.steps.push(makeStep(step, entry.phase.steps.length + 1));
  }
  for (const { phase, min, max } of index.values()) {
    phase.offsetFromServe = { minHours: min, maxHours: max };
  }
  return phases;
}

/** One PlanComponent per recipe in the dinner, ingredients and back-link kept. */
export function componentsFromRecipes(recipes: { recipe: Recipe; scale: number }[]): PlanComponent[] {
  return recipes.map(({ recipe, scale }) => ({
    id: uid('comp'),
    name: recipe.title,
    ingredients: recipe.ingredients.map((i) =>
      scale !== 1 && i.amount != null ? { ...i, amount: i.amount * scale } : i,
    ),
    recipeId: recipe.id,
    ...(recipe.myNotes ? { notes: recipe.myNotes } : {}),
  }));
}
