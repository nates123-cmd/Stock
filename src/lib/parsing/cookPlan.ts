/**
 * Cook Plan parsing — turn a pasted, free-form cook plan (multi-day, multi-
 * component) into a structured `CookPlan`. Two paths, same contract as the
 * recipe parser (§11 / §14.2):
 *   - Claude via the Edge proxy when configured (`parseCookPlanFromText`).
 *   - A deterministic local parser (`localParseCookPlan`) that handles the
 *     common "ALL-CAPS phase header → component sub-headers → `* ` bullets →
 *     numbered cook steps → The full spread:" shape. The local parser is also
 *     the keyless fallback AND the seed builder, so it gets real coverage.
 *
 * Model recap (see src/types): a CookPlan has components (sub-recipes),
 * phases (timeline groups, each with checkable steps), and a spread (the menu).
 * Prep-phase steps link to a component (tap to see its ingredients); the cook
 * phase carries the ordered instructions. Timers/temps are detected onto steps.
 */
import type {
  CookPlan,
  Ingredient,
  PlanComponent,
  PlanPhase,
  PlanStep,
  PlanTimer,
} from '@/types';
import { uid } from '@/lib/id';
import { CLAUDE_AVAILABLE, claudeText } from '@/lib/api/claudeBridge';

export type ParsedCookPlanDraft = Pick<
  CookPlan,
  'title' | 'spread' | 'components' | 'phases'
> & { origin: 'paste' };

/* ------------------------------- helpers -------------------------------- */

const BULLET = /^\s*[*•\-–]\s+/;
const NUMBERED = /^\s*(\d+)[.)]\s+/;

/** A line reads as a phase header when its letters are mostly uppercase
 *  (TONIGHT, TOMORROW AM, TOMORROW NIGHT) — distinguishes phases from the
 *  Title-Case component sub-headers. */
function isPhaseHeader(line: string): boolean {
  // Judge the heading part only — a lowercase "(when back)" parenthetical
  // would otherwise drag "TOMORROW AM" below the uppercase threshold.
  const head = line.replace(/\(.*$/, '').trim();
  const letters = head.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.6;
}

/** hours-before-serve window inferred from a phase label. Honest heuristic;
 *  the user can re-anchor when scheduling. */
function offsetForPhase(label: string): PlanPhase['offsetFromServe'] | undefined {
  const l = label.toLowerCase();
  if (/\btonight\b|\bnight before\b|\bday before\b|\bahead\b/.test(l))
    return { minHours: 12, maxHours: 24 };
  if (/\b(am|morning)\b/.test(l)) return { minHours: 8, maxHours: 12 };
  if (/\b(the cook|night|serve|go[- ]?time|evening)\b/.test(l))
    return { minHours: 0, maxHours: 2 };
  return undefined;
}

/** Pull a temp / duration / long-clock timer out of free text, if present. */
export function detectTimer(text: string): PlanTimer | undefined {
  // Temperature: "325-335", "to 375", "200 degree" — cooking range 150-600°F.
  const temp = text.match(
    /(\d{2,3})\s*(?:[-–]\s*(\d{2,3}))?\s*(?:°\s*f?|degrees?\b|deg\b|\bf\b)/i,
  );
  if (temp) {
    const lo = Number(temp[1]);
    const hi = temp[2] ? Number(temp[2]) : undefined;
    if (lo >= 150 && lo <= 600)
      return { kind: 'temp', label: 'temp', tempF: lo, tempHighF: hi };
  }
  // "to 325-335 for the first fry" — temp without an explicit "degree".
  const toTemp = text.match(/\bto\s+(\d{3})(?:\s*[-–]\s*(\d{3}))?\b/);
  if (toTemp) {
    const lo = Number(toTemp[1]);
    if (lo >= 150 && lo <= 600)
      return {
        kind: 'temp',
        label: 'temp',
        tempF: lo,
        tempHighF: toTemp[2] ? Number(toTemp[2]) : undefined,
      };
  }
  // Long clock window: "8-12 hour", "8 to 12 hours".
  const clock = text.match(/(\d+)\s*(?:[-–]|to)\s*(\d+)\s*(hour|hr|minute|min)/i);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    const word = clock[3] ?? 'hour';
    const unit = word.toLowerCase().startsWith('h') ? 3600 : 60;
    return {
      kind: 'clock',
      label: `${a}-${b} ${word}`,
      minSeconds: a * unit,
      maxSeconds: b * unit,
    };
  }
  // Single duration: "12 minutes", "1 hour".
  const dur = text.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i);
  if (dur) {
    const n = Number(dur[1]);
    const u = (dur[2] ?? 'min').toLowerCase();
    const mult = u.startsWith('h') ? 3600 : u.startsWith('s') ? 1 : 60;
    return { kind: 'duration', label: `${dur[1]} ${dur[2]}`, seconds: n * mult };
  }
  return undefined;
}

/** Parse a single ingredient bullet. Handles "Name: 40 g (note)" and
 *  "1 cup name, prepped" and bare "Salt". Always keeps the original text. */
export function parseIngredientBullet(raw: string): Ingredient {
  const text = raw.replace(BULLET, '').trim();
  let amount: number | null = null;
  let unit: string | null = null;
  let name = text;

  const colon = text.indexOf(':');
  if (colon > 0 && colon < 40) {
    // "Kosher salt: 40 g (~1.5 tsp)"
    name = text.slice(0, colon).trim();
    const rest = text.slice(colon + 1).trim();
    const m = rest.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z%]+)?/);
    if (m) {
      amount = Number(m[1]);
      unit = m[2] ? m[2].toLowerCase() : null;
    }
  } else {
    // "1 cup vegetable oil, heated until shimmering"
    const m = text.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.*)$/);
    if (m) {
      amount = Number(m[1]);
      const maybeUnit = (m[2] ?? '').toLowerCase();
      const KNOWN = /^(g|kg|ml|l|cup|cups|tbsp|tsp|oz|lb|lbs|pc|clove|cloves|knob)$/;
      if (KNOWN.test(maybeUnit)) {
        unit = maybeUnit.replace(/s$/, '');
        name = (m[3] ?? '').trim();
      } else {
        // number wasn't followed by a unit ("2-inch knob ginger") — keep whole
        amount = null;
        name = text;
      }
    }
  }
  return {
    id: uid('ing'),
    amount,
    unit,
    canonicalName: name.toLowerCase(),
    originalText: text,
    modificationHistory: [],
  };
}

/** Short component name derived from a numbered cook step that carries
 *  sub-bullets (e.g. "Mix tempura batter cold, …" → "Tempura batter"). */
function componentNameFromStep(stepText: string): string {
  const clause = (stepText.split(/[,.(]/)[0] ?? stepText).trim();
  const words = clause.replace(/^(mix|make|prep|prepare|whisk|stir)\s+/i, '').split(/\s+/);
  const name = words.slice(0, 4).join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/* ---------------------------- local parser ------------------------------ */

export function localParseCookPlan(text: string): ParsedCookPlanDraft {
  const lines = text.split(/\r?\n/);
  let title = 'Cook Plan';
  const spread: string[] = [];
  const components: PlanComponent[] = [];
  const phases: PlanPhase[] = [];

  let phase: PlanPhase | null = null;
  let component: PlanComponent | null = null;
  let stepOrdinal = 0;

  // Factory only — assignment to the outer `phase`/`component`/`stepOrdinal`
  // happens at the call site so TS narrows their types through the loop (a
  // `let` mutated only inside a closure is treated as never-narrowed).
  const makePhase = (label: string): PlanPhase => {
    const p: PlanPhase = {
      id: uid('phase'),
      label,
      steps: [],
      offsetFromServe: offsetForPhase(label),
    };
    phases.push(p);
    return p;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Title: "Cooking Plan:  Fried Chicken Cook Plan"
    const titleMatch = line.match(/^cook(?:ing)?\s+plan\s*:?\s*(.*)$/i);
    if (titleMatch && phases.length === 0 && !phase) {
      const t = (titleMatch[1] ?? '').trim();
      if (t) title = t;
      continue;
    }

    // The spread / menu line.
    const spreadMatch = line.match(/^(?:the\s+)?full\s+spread\s*:?\s*(.*)$/i) ||
      line.match(/^the\s+spread\s*:?\s*(.*)$/i);
    if (spreadMatch) {
      spread.push(
        ...(spreadMatch[1] ?? '')
          .split(/[,;]|\band\b/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
      continue;
    }

    // Numbered cook step.
    const num = line.match(NUMBERED);
    if (num && phase) {
      const stepText = line.replace(NUMBERED, '').trim();
      stepOrdinal += 1;
      const step: PlanStep = {
        id: uid('pstep'),
        ordinal: stepOrdinal,
        text: stepText,
        timer: detectTimer(stepText),
      };
      phase.steps.push(step);
      // Subsequent bullets belong to a component synthesized from this step.
      component = null;
      // Lazily created when the first sub-bullet appears (see bullet branch).
      (step as PlanStep & { _wantsComponent?: boolean })._wantsComponent = true;
      continue;
    }

    // Bullet → ingredient (or note) for the current component.
    if (BULLET.test(line)) {
      if (!component && phase) {
        // A bullet under a numbered step → make a component for that step.
        const last = phase.steps[phase.steps.length - 1] as
          | (PlanStep & { _wantsComponent?: boolean })
          | undefined;
        const name = last ? componentNameFromStep(last.text) : 'Component';
        component = { id: uid('comp'), name, ingredients: [] };
        components.push(component);
        if (last) last.componentId = component.id;
      }
      if (!component) continue;
      const body = line.replace(BULLET, '').trim();
      // A bullet that's prose (no measurement, sentence-like) → component note.
      const looksLikeNote =
        /\b(starts?|lands?|improves?|note|do not|don't|until|cool|rack)\b/i.test(body) &&
        !/:\s*\d/.test(body) &&
        !/^\d/.test(body);
      if (looksLikeNote) {
        component.notes = component.notes ? `${component.notes}\n${body}` : body;
        // A note may carry the brine clock — hoist its timer onto the step.
        const t = detectTimer(body);
        if (t && phase) {
          const ls = phase.steps.find((s) => s.componentId === component!.id);
          if (ls && !ls.timer) ls.timer = t;
        }
      } else {
        component.ingredients.push(parseIngredientBullet(body));
      }
      continue;
    }

    // Phase header (ALL CAPS).
    if (isPhaseHeader(line)) {
      phase = makePhase(line);
      component = null;
      stepOrdinal = 0;
      continue;
    }

    // Otherwise: a component sub-header (Title Case line inside a phase).
    if (phase) {
      // Split "Name (parenthetical) trailing" — the name is everything before
      // the first "(", the rest becomes the component note.
      const open = line.indexOf('(');
      let name = line;
      let paren: string | undefined;
      let tail: string | undefined;
      if (open >= 0) {
        name = line.slice(0, open).trim();
        const close = line.indexOf(')', open);
        if (close >= 0) {
          paren = line.slice(open + 1, close).trim();
          tail = line.slice(close + 1).trim();
        } else {
          paren = line.slice(open + 1).trim();
        }
      }
      name = name.trim();
      component = {
        id: uid('comp'),
        name,
        ingredients: [],
        notes: [paren, tail].filter(Boolean).join(' ') || undefined,
      };
      // Baker's-% anchor hint.
      if (/baker'?s?\s+percent/i.test(line)) {
        // anchor set after ingredients parsed (first 100% ingredient)
        component.bakersPercent = { anchorIngredientId: '' };
      }
      components.push(component);
      // Prep-phase component → a checkable step that links to it.
      stepOrdinal += 1;
      phase.steps.push({
        id: uid('pstep'),
        ordinal: stepOrdinal,
        text: name,
        componentId: component.id,
        timer: detectTimer(line),
      });
    } else {
      // Pre-phase loose line → seed a default phase.
      phase = makePhase('Prep');
      component = null;
      stepOrdinal = 0;
    }
  }

  // Resolve baker's-% anchors: the ingredient whose original text shows 100%.
  for (const c of components) {
    if (c.bakersPercent && !c.bakersPercent.anchorIngredientId) {
      const anchor = c.ingredients.find((i) => /\b100\s*%/.test(i.originalText ?? ''));
      if (anchor) c.bakersPercent.anchorIngredientId = anchor.id;
      else delete c.bakersPercent;
    }
  }

  // Drop the internal scratch flag.
  for (const p of phases)
    for (const s of p.steps)
      delete (s as PlanStep & { _wantsComponent?: boolean })._wantsComponent;

  return { title, spread, components, phases, origin: 'paste' };
}

/* ----------------------------- Claude path ------------------------------ */

const SYSTEM = `You convert a multi-day cooking plan into STRICT JSON, no prose, no markdown.
A cook plan is a whole meal/event with several sub-recipes (components) and a
timeline of phases. Schema:
{"title":string,
 "spread":string[],
 "components":[{"name":string,"notes":string|null,
   "ingredients":[{"amount":number|null,"unit":string|null,"canonicalName":string,"originalText":string}]}],
 "phases":[{"label":string,
   "offsetFromServe":{"minHours":number,"maxHours":number}|null,
   "steps":[{"text":string,"component":string|null,
     "timer":{"kind":"duration"|"clock"|"temp","label":string,
        "seconds":number|null,"minSeconds":number|null,"maxSeconds":number|null,
        "tempF":number|null,"tempHighF":number|null}|null}]}]}
Rules: "spread" is the final menu (what lands on the table). Each prep action is
a step; link it to a component by name via "component" when it builds one. Put
oil/oven temps as timer kind "temp" (tempF, tempHighF for a range), long brine/
rest windows as "clock" (minSeconds=alarm, maxSeconds=window close), countdowns
as "duration" (seconds). offsetFromServe is hours-before-serve for scheduling
(the cook/serve phase ~ {0,2}; the night-before ~ {12,24}). canonicalName is
lowercase. Output ONLY the JSON object.`;

type RawTimer = {
  kind?: 'duration' | 'clock' | 'temp';
  label?: string;
  seconds?: number | null;
  minSeconds?: number | null;
  maxSeconds?: number | null;
  tempF?: number | null;
  tempHighF?: number | null;
};
type RawPlan = {
  title?: string;
  spread?: string[];
  components?: {
    name?: string;
    notes?: string | null;
    ingredients?: {
      amount?: number | null;
      unit?: string | null;
      canonicalName?: string;
      originalText?: string;
    }[];
  }[];
  phases?: {
    label?: string;
    offsetFromServe?: { minHours: number; maxHours: number } | null;
    steps?: { text?: string; component?: string | null; timer?: RawTimer | null }[];
  }[];
};

function extractJson(text: string): RawPlan {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON in model output');
  return JSON.parse(cleaned.slice(start, end + 1)) as RawPlan;
}

function mapTimer(t: RawTimer | null | undefined): PlanTimer | undefined {
  if (!t || !t.kind) return undefined;
  return {
    kind: t.kind,
    label: t.label ?? t.kind,
    seconds: t.seconds ?? undefined,
    minSeconds: t.minSeconds ?? undefined,
    maxSeconds: t.maxSeconds ?? undefined,
    tempF: t.tempF ?? undefined,
    tempHighF: t.tempHighF ?? undefined,
  };
}

function mapRaw(raw: RawPlan): ParsedCookPlanDraft {
  const components: PlanComponent[] = (raw.components ?? []).map((c) => ({
    id: uid('comp'),
    name: (c.name ?? 'Component').trim(),
    notes: c.notes ?? undefined,
    ingredients: (c.ingredients ?? []).map((i) => ({
      id: uid('ing'),
      amount: i.amount ?? null,
      unit: i.unit ?? null,
      canonicalName: (i.canonicalName ?? '').trim().toLowerCase(),
      originalText: i.originalText,
      modificationHistory: [],
    })),
  }));
  const byName = new Map(components.map((c) => [c.name.toLowerCase(), c.id]));

  const phases: PlanPhase[] = (raw.phases ?? []).map((p) => ({
    id: uid('phase'),
    label: (p.label ?? 'Phase').trim(),
    offsetFromServe: p.offsetFromServe ?? undefined,
    steps: (p.steps ?? []).map((s, idx) => ({
      id: uid('pstep'),
      ordinal: idx + 1,
      text: (s.text ?? '').trim(),
      componentId: s.component ? byName.get(s.component.toLowerCase()) : undefined,
      timer: mapTimer(s.timer),
    })),
  }));

  return {
    title: raw.title?.trim() || 'Cook Plan',
    spread: Array.isArray(raw.spread) ? raw.spread.map((s) => s.trim()).filter(Boolean) : [],
    components,
    phases,
    origin: 'paste',
  };
}

/** §11-style: parse a pasted cook plan. Claude when available, else local. */
export async function parseCookPlanFromText(text: string): Promise<ParsedCookPlanDraft> {
  if (CLAUDE_AVAILABLE) {
    try {
      const out = await claudeText('cook-plan-parse', SYSTEM, text);
      const mapped = mapRaw(extractJson(out));
      // If the model returned something thin, prefer the structural parser.
      if (mapped.phases.length > 0 || mapped.components.length > 0) return mapped;
    } catch (e) {
      console.warn('[stock] cook-plan Claude parse failed, using local', e);
    }
  }
  return localParseCookPlan(text);
}
