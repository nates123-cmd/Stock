/**
 * Instacart + Pipeline parsing — spec §11 tasks 6, 7 (build order §13 step 6).
 *
 * Task 6 is implemented: Claude when EXPO_PUBLIC_ANTHROPIC_API_KEY is set
 * (spec §11.6), otherwise a deterministic local fallback so the paste flow
 * still works in a keyless preview (spec §14.2). Task 7 stays a typed stub.
 */
import type { Ingredient } from '@/types';
import { uid } from '@/lib/id';
import { CLAUDE_AVAILABLE, claudeText } from '@/lib/api/claudeBridge';
import type { Confidenced } from './confidence';
import { hasApiKey } from './recipe';
import { localParseInstacart } from './localInstacart';
import { localBestGuess } from './localBestGuess';

export type ParsedPantryItem = Confidenced<{
  canonicalName: string;
  amount?: number;
  unit?: string;
  originalInstacartText: string;
  tag: 'restock' | 'staple' | 'sub' | 'new';
}>;

const SYSTEM = `You convert a grocery order (Instacart email, cart text, or a
loose list) into STRICT JSON, no prose, no markdown.
Schema: {"items":[{"canonicalName":string,"amount":number|null,"unit":string|null,"originalInstacartText":string,"tag":"sub"|"new"}]}
canonicalName is brand-stripped, lowercased, normalized (e.g.
"Organic Valley Whole Milk, 1 gal" -> "milk, whole";
"Driscoll's Raspberries, 6 oz x 2" -> "raspberries" with amount 12, unit "oz").
Convert multi-packs to a single total amount. tag is "sub" when the line
describes a substitution, else "new". originalInstacartText is the raw line.
Output ONLY the JSON object.`;

type RawItem = {
  canonicalName?: string;
  amount?: number | null;
  unit?: string | null;
  originalInstacartText?: string;
  tag?: 'sub' | 'new';
};

function extractItems(text: string): RawItem[] {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON in model output');
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as { items?: RawItem[] };
  if (!Array.isArray(obj.items)) throw new Error('no items array in model output');
  return obj.items;
}

/**
 * §11.6 — line-by-line item extraction with canonical naming. Handles
 * brand-stripping, multi-pack math, unit normalization (spec §10
 * "Canonical-vs-original name resolution").
 */
export async function parseInstacartPaste(
  text: string,
): Promise<ParsedPantryItem[]> {
  if (hasApiKey() && CLAUDE_AVAILABLE) {
    try {
      const out = await claudeText('instacart-parse', SYSTEM, text);
      return extractItems(out)
        .filter((i) => (i.canonicalName ?? '').trim().length > 1)
        .map((i) => ({
          value: {
            canonicalName: i.canonicalName!.trim().toLowerCase(),
            amount: i.amount ?? undefined,
            unit: i.unit ?? undefined,
            originalInstacartText: i.originalInstacartText?.trim() || i.canonicalName!.trim(),
            tag: i.tag === 'sub' ? 'sub' : 'new',
          },
          confidence: 'parsed',
        }));
    } catch (e) {
      console.warn('[stock] Claude instacart parse failed, using local fallback', e);
    }
  }
  return localParseInstacart(text);
}

const BG_SYSTEM = `You turn a cook's rough "what I'll probably use" note for a
dish into STRICT JSON, no prose, no markdown.
Schema: {"ingredients":[{"amount":number|null,"unit":string|null,"canonicalName":string,"originalText":string}]}
canonicalName is lowercased and normalized. These are PRE-COOK GUESSES, so be
conservative and include only what's stated or strongly implied. Output ONLY
the JSON object.`;

function extractBgIngredients(text: string): {
  amount?: number | null;
  unit?: string | null;
  canonicalName?: string;
  originalText?: string;
}[] {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON in model output');
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
    ingredients?: {
      amount?: number | null;
      unit?: string | null;
      canonicalName?: string;
      originalText?: string;
    }[];
  };
  if (!Array.isArray(obj.ingredients)) throw new Error('no ingredients array');
  return obj.ingredients;
}

/**
 * §11.7 — given a Pipeline idea and the cook's free-text ingredient hunch,
 * propose best-guess ingredients for plan-as-experiment (spec §8 / §5
 * "Pipeline → Plan as experiment"). Always flagged "guessed".
 */
export async function bestGuessIngredients(
  ideaTitle: string,
  freeText: string,
): Promise<Confidenced<Ingredient>[]> {
  if (hasApiKey() && CLAUDE_AVAILABLE) {
    try {
      const out = await claudeText(
        'best-guess-ingredients',
        BG_SYSTEM,
        `Dish: ${ideaTitle}\nNotes: ${freeText}`,
      );
      return extractBgIngredients(out)
        .filter((i) => (i.canonicalName ?? '').trim().length > 0)
        .map((i) => ({
          value: {
            id: uid('ing'),
            amount: i.amount ?? null,
            unit: i.unit ?? null,
            canonicalName: i.canonicalName!.trim().toLowerCase(),
            originalText: i.originalText?.trim(),
            modificationHistory: [],
          },
          confidence: 'guessed' as const,
        }));
    } catch (e) {
      console.warn('[stock] Claude best-guess failed, using local fallback', e);
    }
  }
  return localBestGuess(freeText);
}
