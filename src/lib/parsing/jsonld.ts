/**
 * schema.org/Recipe JSON-LD extraction — spec §11.1.
 *
 * Most recipe sites (NYT included) embed a `<script type="application/ld+json">`
 * Recipe block. It's clean, ad-free, paywall-free, and carries the photo +
 * nutrition + yield that tag-stripping throws away. We pull it, hand the
 * ingredient/step TEXT to the existing parser (so unit/amount/fraction logic
 * still applies), and keep the structured image/nutrition/yield as bonuses.
 */
import type { Nutrition } from '@/types';

export type JsonLdRecipe = {
  title?: string;
  ingredients: string[];
  steps: string[];
  imageUrl?: string;
  nutrition?: Nutrition;
  serves?: number;
  totalMinutes?: number;
  tags: string[];
  /** schema.org publisher.name — stronger source-label signal than hostname */
  publisher?: string;
  /** schema.org author.name — fallback when no publisher */
  author?: string;
};

type Json = Record<string, unknown>;

const SCRIPT_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&frac12;/g, '½')
    .replace(/&deg;/g, '°')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNumber(v: unknown): number | undefined {
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : undefined;
}

/** ISO-8601 duration → minutes ("PT1H30M" → 90, "PT45M" → 45). */
function isoToMinutes(v: unknown): number | undefined {
  const m = String(v ?? '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + +(m[3] ?? 0);
}

/** publisher / author can be a string, an Organization/Person, or an array. */
function resolveName(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return decodeEntities(v) || undefined;
  if (Array.isArray(v)) return resolveName(v[0]);
  if (typeof v === 'object') {
    const n = (v as Json).name;
    return typeof n === 'string' ? decodeEntities(n) || undefined : undefined;
  }
  return undefined;
}

function resolveImage(img: unknown): string | undefined {
  if (!img) return undefined;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return resolveImage(img[0]);
  if (typeof img === 'object') {
    const u = (img as Json).url;
    return typeof u === 'string' ? u : undefined;
  }
  return undefined;
}

/** recipeInstructions: string | string[] | HowToStep[] | HowToSection[]. */
function flattenSteps(node: unknown): string[] {
  if (!node) return [];
  if (typeof node === 'string')
    // Split on newlines BEFORE decoding — decodeEntities collapses \s+ to a
    // space, which would otherwise fuse a multi-line method into one step.
    return node
      .split(/\r?\n+/)
      .map((s) => decodeEntities(s))
      .filter(Boolean);
  if (Array.isArray(node)) return node.flatMap(flattenSteps);
  if (typeof node === 'object') {
    const o = node as Json;
    if (Array.isArray(o.itemListElement)) return flattenSteps(o.itemListElement);
    const t = o.text ?? o.name;
    return typeof t === 'string' ? [decodeEntities(t)] : [];
  }
  return [];
}

/** Tag-ish fields: a single string is comma-delimited; arrays are kept. */
function toTagArray(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return v.split(',').map((s) => s.trim());
  if (Array.isArray(v)) return v.flatMap(toTagArray);
  return [];
}

/** List fields (ingredients): each array element is ONE item — never split
 *  on its commas. A lone string falls back to newline-splitting. */
function toLines(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v))
    return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  if (typeof v === 'string')
    return v.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function extractNutrition(n: unknown): Nutrition | undefined {
  if (!n || typeof n !== 'object') return undefined;
  const o = n as Json;
  const out: Nutrition = { per: 'serving', source: 'extracted' };
  out.calories = firstNumber(o.calories);
  out.protein = firstNumber(o.proteinContent);
  out.carbs = firstNumber(o.carbohydrateContent);
  out.fat = firstNumber(o.fatContent);
  return out.calories != null ||
    out.protein != null ||
    out.carbs != null ||
    out.fat != null
    ? out
    : undefined;
}

function collect(node: unknown, acc: Json[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, acc));
    return;
  }
  const o = node as Json;
  if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach((n) => collect(n, acc));
  acc.push(o);
}

function isRecipe(n: Json): boolean {
  const t = n['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

/** Pull the first schema.org/Recipe from a page's JSON-LD, or null. */
export function extractRecipeJsonLd(html: string): JsonLdRecipe | null {
  const nodes: Json[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    try {
      collect(JSON.parse(raw), nodes);
    } catch {
      /* a malformed block shouldn't kill the others */
    }
  }
  const r = nodes.find(isRecipe);
  if (!r) return null;

  const ingredients = toLines(r.recipeIngredient ?? r.ingredients)
    .map((s) => decodeEntities(s))
    .filter(Boolean);
  const steps = flattenSteps(r.recipeInstructions).filter(Boolean);
  if (ingredients.length === 0 || steps.length === 0) return null;

  const tags = Array.from(
    new Set(
      [
        ...toTagArray(r.keywords),
        ...toTagArray(r.recipeCategory),
        ...toTagArray(r.recipeCuisine),
      ]
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t && t.length <= 24),
    ),
  ).slice(0, 8);

  return {
    title: typeof r.name === 'string' ? decodeEntities(r.name) : undefined,
    ingredients,
    steps,
    imageUrl: resolveImage(r.image),
    nutrition: extractNutrition(r.nutrition),
    serves: firstNumber(
      Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield,
    ),
    totalMinutes:
      isoToMinutes(r.totalTime) ??
      (isoToMinutes(r.cookTime) != null || isoToMinutes(r.prepTime) != null
        ? (isoToMinutes(r.cookTime) ?? 0) + (isoToMinutes(r.prepTime) ?? 0)
        : undefined),
    tags,
    publisher: resolveName(r.publisher),
    author: resolveName(r.author),
  };
}
