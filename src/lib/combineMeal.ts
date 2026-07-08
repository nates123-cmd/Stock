/**
 * Cook "Combine" — merge several dishes' step lists into ONE back-scheduled
 * procedure anchored to a serve time (redesign Phase C, REDESIGN.md §"Cook
 * combine"). Claude reads every dish's steps, interleaves them and hangs each
 * on an offset relative to T-0 (plate/serve), make-ahead aware (marinate the
 * night before, start rice an hour out, sear at T-20m…).
 *
 * Graceful degrade: when Claude is unavailable (or the call/parse fails) we
 * fall back to concatenating each dish's steps in order, grouped and labeled
 * per dish, with no offsets — so the feature still works offline and never
 * crashes. The result (Claude or fallback) is cached in the shared ai-cache
 * keyed on the dishes' content, so re-opening a meal doesn't regenerate it.
 */
import { CLAUDE_AVAILABLE, claudeText } from '@/lib/api/claudeBridge';
import { makeAiCache } from '@/lib/api/cache';
import { cacheKey } from '@/lib/api';
import type { Step } from '@/types';

/** One line of the combined timeline. */
export type CombinedStep = {
  /** Offset relative to serve time — "T-24h", "T-45m", "T-0". Empty in the
   *  offline fallback (steps are only grouped/ordered, not scheduled). */
  offsetLabel: string;
  /** Short imperative instruction. */
  text: string;
  /** Which dish this step belongs to (display title), or undefined for a
   *  shared plating/serve step. */
  dish?: string;
};

export type CombinedPlan = {
  steps: CombinedStep[];
  /** How the plan was produced — the UI notes offline (fallback) mode. */
  source: 'claude' | 'fallback';
};

/** A dish handed to the combiner: its title + its ordered recipe steps. */
export type CombineDish = {
  title: string;
  steps: Step[];
};

export type CombineOptions = {
  /** Label for T-0 (default "serve"). */
  serveLabel?: string;
  /** Skip the cache read and regenerate (the "Regenerate" button). */
  force?: boolean;
};

const CACHE_TASK = 'cook-plan';

const SYSTEM = `You are a chef planning how to cook a whole meal made of several
dishes so they are all ready together at one serve time. You are given each dish
and its ordered steps. Produce ONE interleaved, back-scheduled timeline of every
step, anchored to the serve time (T-0 = plate and serve).

Rules:
- Hang each step on an offset relative to serve time, e.g. "T-24h", "T-2h",
  "T-45m", "T-20m", "T-0". Spread make-ahead work hours or days earlier
  (marinating, brining, chilling dough, resting) and cluster active cooking near
  T-0.
- Interleave the dishes so nothing sits done-and-cold: order the whole list from
  earliest (largest offset) down to T-0.
- Keep each step's text short and imperative. Do not number the steps.
- Attribute every step to the dish it came from.

Input JSON: {"serveLabel":string,"dishes":[{"title":string,"steps":[string]}]}
Output STRICT JSON, no prose, no markdown:
{"steps":[{"offsetLabel":string,"text":string,"dish":string}]}
- offsetLabel: relative-to-serve label (e.g. "T-1h", "T-0").
- dish: one of the input dish titles, or "" for a shared plating/serve step.
Output ONLY the JSON object.`;

/** Ordered step strings for a dish (title preferred, body as fallback). */
function dishStepTexts(dish: CombineDish): string[] {
  return [...dish.steps]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => (s.title || s.body || '').trim())
    .filter((t) => t.length > 0);
}

/** Offline fallback: each dish's steps in order, grouped + labeled per dish. */
function fallbackPlan(dishes: CombineDish[]): CombinedPlan {
  const steps: CombinedStep[] = [];
  for (const dish of dishes) {
    const texts = dishStepTexts(dish);
    if (texts.length === 0) {
      steps.push({ offsetLabel: '', text: `Cook ${dish.title}`, dish: dish.title });
      continue;
    }
    for (const text of texts) steps.push({ offsetLabel: '', text, dish: dish.title });
  }
  return { steps, source: 'fallback' };
}

/** Tolerant JSON parse of Claude's timeline — mirrors src/lib/parsing style. */
function parseClaudePlan(out: string): CombinedStep[] {
  const cleaned = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('cook-plan: no JSON in response');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    steps?: { offsetLabel?: unknown; text?: unknown; dish?: unknown }[];
  };
  if (!Array.isArray(parsed.steps)) throw new Error('cook-plan: no steps array');
  const steps: CombinedStep[] = [];
  for (const s of parsed.steps) {
    const text = typeof s.text === 'string' ? s.text.trim() : '';
    if (!text) continue;
    steps.push({
      offsetLabel: typeof s.offsetLabel === 'string' ? s.offsetLabel.trim() : '',
      text,
      dish:
        typeof s.dish === 'string' && s.dish.trim().length > 0
          ? s.dish.trim()
          : undefined,
    });
  }
  return steps;
}

/**
 * Build (or reuse) the combined back-scheduled timeline for a meal's dishes.
 * Never throws — any failure degrades to the sequential fallback.
 */
export async function combineMeal(
  dishes: CombineDish[],
  opts: CombineOptions = {},
): Promise<CombinedPlan> {
  const cookable = dishes.filter((d) => d.title.trim().length > 0);
  if (cookable.length === 0) return { steps: [], source: 'fallback' };

  const serveLabel = opts.serveLabel ?? 'serve';
  const payload = {
    serveLabel,
    dishes: cookable.map((d) => ({ title: d.title, steps: dishStepTexts(d) })),
  };
  const input = JSON.stringify(payload);
  const cache = makeAiCache(CACHE_TASK);
  const key = cacheKey(CACHE_TASK, input);

  if (!opts.force) {
    try {
      const hit = await cache.get(key);
      if (hit) {
        const cached = JSON.parse(hit) as CombinedPlan;
        if (Array.isArray(cached.steps)) return cached;
      }
    } catch {
      /* stale/corrupt cache — regenerate */
    }
  }

  let plan: CombinedPlan;
  if (CLAUDE_AVAILABLE) {
    try {
      const out = await claudeText('cook-combine', SYSTEM, input);
      const steps = parseClaudePlan(out);
      plan = steps.length > 0 ? { steps, source: 'claude' } : fallbackPlan(cookable);
    } catch {
      plan = fallbackPlan(cookable);
    }
  } else {
    plan = fallbackPlan(cookable);
  }

  try {
    await cache.set(key, JSON.stringify(plan));
  } catch {
    /* cache write best-effort */
  }
  return plan;
}
