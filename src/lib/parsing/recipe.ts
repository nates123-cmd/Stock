/**
 * Recipe parsing tasks — spec §11 tasks 1, 2, 3, 8, 9, 10.
 *
 * Tasks 1 & 2 are implemented: Claude when EXPO_PUBLIC_ANTHROPIC_API_KEY is
 * set (spec §11), otherwise a deterministic local fallback so capture still
 * works in a keyless preview (spec §14.2). Tasks 3/8/9/10 remain typed stubs
 * for later build steps.
 */
import type { Ingredient, Nutrition, Recipe, RecipeSource, Step } from '@/types';
import { uid } from '@/lib/id';
import {
  CLAUDE_AVAILABLE,
  claudeText,
  claudePdf,
  claudeImage,
  proxyFetch,
  type ImageMediaType,
} from '@/lib/api/claudeBridge';
import { localParseRecipe } from './localRecipe';
import { extractRecipeJsonLd } from './jsonld';

export type ParsedRecipeDraft = Partial<Recipe> & {
  /** which fields were inferred vs. extracted, per spec §11 confidence flags */
  fieldConfidence?: Record<string, 'extracted' | 'parsed' | 'guessed'>;
};

export function hasApiKey(): boolean {
  return !!process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
}

/**
 * Friendly names for well-known cooking sites — recognized by hostname
 * regardless of subdomain. Anything not in the map falls back to a
 * tidied hostname (so a recipe from `homemade-pizza.com` becomes
 * "homemade-pizza.com", not just generic "Mine").
 */
const KNOWN_SOURCES: { match: RegExp; name: string; type?: RecipeSource['type'] }[] = [
  { match: /\bcooking\.nytimes\.com$/i, name: 'NYT Cooking', type: 'nyt' },
  { match: /\bnytimes\.com$/i, name: 'The New York Times', type: 'nyt' },
  { match: /\b(youtube\.com|youtu\.be)$/i, name: 'YouTube', type: 'yt' },
  { match: /\bseriouseats\.com$/i, name: 'Serious Eats' },
  { match: /\bbonappetit\.com$/i, name: 'Bon Appétit' },
  { match: /\bkingarthurbaking\.com$/i, name: 'King Arthur Baking' },
  { match: /\bfood52\.com$/i, name: 'Food52' },
  { match: /\bsmittenkitchen\.com$/i, name: 'Smitten Kitchen' },
  { match: /\bminimalistbaker\.com$/i, name: 'Minimalist Baker' },
  { match: /\bbbcgoodfood\.com$/i, name: 'BBC Good Food' },
  { match: /\bbbc\.co\.uk$/i, name: 'BBC Food' },
  { match: /\ballrecipes\.com$/i, name: 'AllRecipes' },
  { match: /\bfood\.com$/i, name: 'Food.com' },
  { match: /\bepicurious\.com$/i, name: 'Epicurious' },
  { match: /\bthekitchn\.com$/i, name: 'The Kitchn' },
  { match: /\bfoodnetwork\.com$/i, name: 'Food Network' },
  { match: /\bdelish\.com$/i, name: 'Delish' },
  { match: /\bsimplyrecipes\.com$/i, name: 'Simply Recipes' },
  { match: /\bnytcooking\.com$/i, name: 'NYT Cooking', type: 'nyt' },
];

/** Classify provenance from a URL (spec §6 "Detected" badge). */
export function detectSource(url?: string): RecipeSource {
  if (!url) return { type: 'mine' };
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return { type: 'mine', url };
  }
  for (const k of KNOWN_SOURCES) {
    if (k.match.test(host)) {
      return { type: k.type ?? 'web', url, name: k.name };
    }
  }
  return { type: 'web', url, name: host };
}

const SYSTEM = `You convert a recipe into STRICT JSON, no prose, no markdown.
Schema: {"title":string,"serves":number,"totalMinutes":number|null,
"tags":string[],
"ingredients":[{"amount":number|null,"unit":string|null,"canonicalName":string,"originalText":string}],
"steps":[{"title":string,"body":string}],
"nutrition":{"calories":number|null,"protein":number|null,"carbs":number|null,"fat":number|null}}
canonicalName is normalized & lowercase (e.g. "olive oil, evoo"). title is a
short 3-6 word step summary. nutrition is your best PER-SERVING estimate from
the ingredients (calories in kcal; protein/carbs/fat in grams); use null only
if you genuinely cannot estimate. Output ONLY the JSON object.`;

type RawDraft = {
  title?: string;
  serves?: number;
  totalMinutes?: number | null;
  tags?: string[];
  ingredients?: { amount: number | null; unit: string | null; canonicalName: string; originalText?: string }[];
  steps?: { title: string; body: string }[];
  nutrition?: {
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
  };
};

function mapRaw(raw: RawDraft): Pick<Recipe, 'ingredients' | 'steps'> & {
  title?: string;
  yield: { serves: number; totalMinutes?: number };
  tags: string[];
  nutrition?: Nutrition;
} {
  const ingredients: Ingredient[] = (raw.ingredients ?? []).map((i) => ({
    id: uid('ing'),
    amount: i.amount ?? null,
    unit: i.unit ?? null,
    canonicalName: (i.canonicalName ?? '').trim(),
    originalText: i.originalText,
    modificationHistory: [],
  }));
  const steps: Step[] = (raw.steps ?? []).map((s, idx) => ({
    id: uid('stp'),
    ordinal: idx + 1,
    title: s.title?.trim() || `Step ${idx + 1}`,
    body: s.body?.trim() ?? '',
    parsedTimers: [],
    parsedAmounts: [],
    modificationHistory: [],
  }));
  const n = raw.nutrition;
  const nutrition: Nutrition | undefined =
    n && (n.calories != null || n.protein != null || n.carbs != null || n.fat != null)
      ? {
          per: 'serving',
          source: 'estimated',
          calories: n.calories ?? undefined,
          protein: n.protein ?? undefined,
          carbs: n.carbs ?? undefined,
          fat: n.fat ?? undefined,
        }
      : undefined;
  return {
    title: raw.title?.trim(),
    yield: { serves: raw.serves && raw.serves > 0 ? raw.serves : 4, totalMinutes: raw.totalMinutes ?? undefined },
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => t.toLowerCase()) : [],
    ingredients,
    steps,
    nutrition,
  };
}

function extractJson(text: string): RawDraft {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON in model output');
  return JSON.parse(cleaned.slice(start, end + 1)) as RawDraft;
}

/** §11.2 — parse pasted text / OCR output into a recipe draft. */
export async function parseRecipeFromText(
  text: string,
  source: RecipeSource = { type: 'mine' },
): Promise<ParsedRecipeDraft> {
  if (CLAUDE_AVAILABLE) {
    try {
      const out = await claudeText('recipe-parse', SYSTEM, text);
      const mapped = mapRaw(extractJson(out));
      const conf = source.type === 'nyt' ? 'extracted' : 'parsed';
      return {
        ...mapped,
        source,
        status: 'draft',
        fieldConfidence: { title: conf, ingredients: conf, steps: conf, yield: conf },
      };
    } catch (e) {
      console.warn('[stock] Claude parse failed, using local fallback', e);
    }
  }
  const local = localParseRecipe(text);
  return { ...local, source, status: 'draft' };
}

/** §11.1 — fetch a recipe URL (NYT/generic) and structure it. */
export async function parseRecipeFromUrl(url: string): Promise<ParsedRecipeDraft> {
  const source = detectSource(url);
  let html = '';
  try {
    // Server-side via the proxy on web (browser blocks cross-origin recipe
    // sites with CORS); direct fetch on native.
    html = await proxyFetch(url);
  } catch (e) {
    console.warn('[stock] URL fetch failed', e);
    throw new Error('Could not fetch that URL. Paste the recipe text instead.');
  }

  // Preferred path: structured JSON-LD (clean, ad/paywall-free, carries the
  // photo + nutrition + yield). Its ingredient/step text still goes through
  // the normal parser so unit/amount/fraction logic applies.
  const ld = extractRecipeJsonLd(html);
  if (ld && ld.ingredients.length > 0 && ld.steps.length > 0) {
    const text =
      `${ld.title ?? ''}\n\nIngredients:\n${ld.ingredients.join('\n')}\n\n` +
      `Method:\n${ld.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    // schema.org publisher/author is a stronger source label than hostname —
    // upgrade the detected source with it before parsing.
    const ldName = ld.publisher || ld.author;
    const enhancedSource = ldName ? { ...source, name: ldName } : source;
    const draft = await parseRecipeFromText(text, enhancedSource);
    return {
      ...draft,
      title: draft.title || ld.title,
      imageUrl: ld.imageUrl ?? draft.imageUrl,
      // Extracted nutrition beats Claude's estimate.
      nutrition: ld.nutrition ?? draft.nutrition,
      yield: {
        serves: ld.serves ?? draft.yield?.serves ?? 4,
        totalMinutes: ld.totalMinutes ?? draft.yield?.totalMinutes,
      },
      tags: Array.from(new Set([...(draft.tags ?? []), ...ld.tags])),
      fieldConfidence: {
        ...(draft.fieldConfidence ?? {}),
        title: 'extracted',
        ingredients: 'extracted',
        steps: 'extracted',
        yield: 'extracted',
      },
    };
  }

  // Fallback: strip tags and let the text parser do its best.
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
  const body =
    (title ? `${title}\n` : '') +
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  return parseRecipeFromText(body, source);
}

const PDF_PROMPT =
  'Extract the recipe from the attached PDF into the JSON schema. ' +
  'Output ONLY the JSON object.';

/**
 * §11.1 — parse an uploaded recipe PDF. Claude reads it natively (a printed
 * or "Save as PDF" export is clean, ad/paywall-free, and already past any
 * login). No local fallback — there is no on-device PDF reader.
 */
export async function parseRecipeFromPdf(
  base64: string,
  source: RecipeSource = { type: 'mine' },
): Promise<ParsedRecipeDraft> {
  if (!CLAUDE_AVAILABLE) {
    throw new Error(
      'PDF import needs Claude — add EXPO_PUBLIC_ANTHROPIC_API_KEY (native) ' +
        'or configure the Claude proxy (web).',
    );
  }
  const out = await claudePdf('recipe-pdf', SYSTEM, base64, PDF_PROMPT);
  const mapped = mapRaw(extractJson(out));
  return {
    ...mapped,
    source,
    status: 'draft',
    fieldConfidence: {
      title: 'extracted',
      ingredients: 'extracted',
      steps: 'extracted',
      yield: 'extracted',
    },
  };
}

const IMAGE_PROMPT =
  'Read the recipe in this image (photo of a printed page, screenshot, or ' +
  'handwriting) and extract it into the JSON schema. If the image is not a ' +
  'recipe, still return the JSON but leave ingredients/steps empty. ' +
  'Output ONLY the JSON object.';

/**
 * §11.1 — parse a photo or screenshot of a recipe. Claude vision OCRs and
 * structures in one shot. No local fallback — there's no on-device OCR.
 * Fields are marked `parsed` (not `extracted`) because OCR/handwriting
 * ambiguity is real; the review screen will let the user fix anything wrong.
 */
export async function parseRecipeFromImage(
  imageBase64: string,
  imageMediaType: ImageMediaType,
  source: RecipeSource = { type: 'mine' },
): Promise<ParsedRecipeDraft> {
  if (!CLAUDE_AVAILABLE) {
    throw new Error(
      'Photo import needs Claude — add EXPO_PUBLIC_ANTHROPIC_API_KEY (native) ' +
        'or configure the Claude proxy (web).',
    );
  }
  const out = await claudeImage(
    'recipe-image',
    SYSTEM,
    imageBase64,
    imageMediaType,
    IMAGE_PROMPT,
  );
  const mapped = mapRaw(extractJson(out));
  if ((mapped.ingredients?.length ?? 0) === 0 && (mapped.steps?.length ?? 0) === 0) {
    throw new Error("I couldn't find a recipe in that image. Try a clearer shot.");
  }
  return {
    ...mapped,
    source,
    status: 'draft',
    fieldConfidence: {
      title: 'parsed',
      ingredients: 'parsed',
      steps: 'parsed',
      yield: 'parsed',
    },
  };
}

/** §11.3 — infer recipe structure from a YouTube transcript (low confidence). */
export async function inferRecipeFromTranscript(
  _transcript: string,
): Promise<ParsedRecipeDraft> {
  // TODO: callClaude(MODELS.reasoning) — flag inferred fields as "guessed".
  throw new Error('not implemented — spec §11.3');
}

/** §11.8 — detect timers/temperature with positions in a step body. */
export async function detectTimersAndTemperature(
  _stepBody: string,
): Promise<Pick<Step, 'parsedTimers' | 'parsedTemperature'>> {
  // TODO: callClaude(MODELS.fast).
  throw new Error('not implemented — spec §11.8');
}

/** §11.9 — short Glance-mode title from a full step body. */
export async function generateStepTitle(_stepBody: string): Promise<string> {
  // TODO: callClaude(MODELS.fast). Open Q §14.7: parse-time vs. lazy.
  throw new Error('not implemented — spec §11.9');
}

/** §11.10 — on capture, find Pipeline ideas matching the recipe. */
export async function matchPipelineKeywords(
  _recipeText: string,
  _ideaTitles: { id: string; title: string }[],
): Promise<string[]> {
  // TODO: callClaude(MODELS.fast) — returns matching idea ids.
  throw new Error('not implemented — spec §11.10');
}
