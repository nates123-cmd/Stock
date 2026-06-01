/**
 * Keyless heuristic Instacart parser — the fallback used when no Claude API
 * key is configured (spec §14.2). Deterministic and dependency-free; handles
 * the spec §10 "Canonical-vs-original name resolution" cases: brand-stripping,
 * multi-pack math, quantity normalization, substitution detection.
 *
 * When a key IS present, parsing/instacart.ts prefers Claude (spec §11.6) and
 * only falls back here on error. Everything here is flagged "parsed" — line
 * extraction, not deep inference.
 */
import type { ParsedPantryItem } from './instacart';

/** Lines that are order chrome, not items. */
const JUNK_RE =
  /^(your order|order summary|delivered|delivery|subtotal|total|tax|tip|service fee|items?|receipt|thank you|reorder|view order|track|out of stock|refunded|\$?\d[\d.,]*\s*$|qty\b)/i;

/** Substitution language → the item that actually arrived (spec §10). */
const SUB_RE = /\b(substitut\w*|replaced with|swapped (?:for|with)|sub(?:bed)?:?)\b/i;

const SIZE_RE =
  /\b\d+(?:\.\d+)?\s*(?:fl\s*)?(?:oz|g|kg|mg|lb|lbs|ml|l|gal|qt|pt|ct|count|dozen|pack|pk|bunch|each|ea)\b\.?/gi;

const PRICE_RE = /\$\s*\d+(?:\.\d{1,2})?/g;

/** Leading count: "2 ", "2× ", "2x ", "(2) ", "2 ct " */
const LEAD_QTY_RE = /^\s*\(?(\d+(?:\.\d+)?)\)?\s*(?:[×x]|ct\b|count\b)?\s+/i;

/** Multi-pack: "6 oz × 2", "2 × 6 oz", "2-pack 6 oz" → total amount + unit. */
// Unit alternations list the plural forms FIRST so the regex engine prefers
// the longer match ("lbs" before "lb"); otherwise "lb" matches and the
// trailing "s" breaks the \b boundary, dropping the size. normalizeUnit()
// collapses the plural back to canonical.
const PACK_A = /(\d+(?:\.\d+)?)\s*(oz|g|kg|lbs|lb|ml|l)\b[\s.]*[×x]\s*(\d+)/i;
const PACK_B = /(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(oz|g|kg|lbs|lb|ml|l)\b/i;
const SINGLE_SIZE = /(\d+(?:\.\d+)?)\s*(oz|g|kg|lbs|lb|ml|l|gal)\b/i;

function normalizeUnit(u: string): string {
  const x = u.toLowerCase();
  if (x === 'lbs') return 'lb';
  if (x === 'gal') return 'l'; // ~ normalize to base-ish; display stays original
  return x;
}

function quantity(line: string): { amount?: number; unit?: string } {
  let m = line.match(PACK_A);
  if (m) return { amount: +m[1]! * +m[3]!, unit: normalizeUnit(m[2]!) };
  m = line.match(PACK_B);
  if (m) return { amount: +m[1]! * +m[2]!, unit: normalizeUnit(m[3]!) };
  m = line.match(SINGLE_SIZE);
  if (m) return { amount: +m[1]!, unit: normalizeUnit(m[2]!) };
  m = line.match(LEAD_QTY_RE);
  if (m) return { amount: +m[1]!, unit: 'pc' };
  return {};
}

/**
 * Brand- and size-strip to a canonical food name. We can't know every brand,
 * so the heuristic is conservative: strip price, parentheticals, sizes, and a
 * leading Capitalized brand run, then lowercase and de-pluralize lightly.
 */
function canonicalize(raw: string): string {
  let s = raw
    .replace(PRICE_RE, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,?\s*\d+(?:\.\d+)?\s*[×x]\s*\d+.*$/i, ' ') // pack tail
    .replace(SIZE_RE, ' ')
    .replace(LEAD_QTY_RE, ' ')
    .replace(/\b(organic|fresh|large|small|medium|whole|sliced|boneless|skinless|raw)\b/gi, ' ')
    .replace(/[•*\-–—]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Drop a leading Capitalized brand run if a lowercase food word follows
  // ("Trader Joes mango salsa" → "mango salsa", "King Arthur Bread Flour" kept
  // when all-caps-ish because the noun is also capitalized).
  let tokens = s.split(' ');
  if (tokens.length > 2) {
    const firstLower = tokens.findIndex((t) => /^[a-z]/.test(t));
    if (firstLower > 0 && firstLower < tokens.length) s = tokens.slice(firstLower).join(' ');
  }

  // A leading possessive token is almost always the brand, even when the food
  // noun that follows is also Capitalized ("Driscoll's Raspberries" →
  // "Raspberries"). Strip it as long as at least one token remains. This is a
  // strong brand signal, so it fires for the common 2-token case the
  // Capitalized-run rule above (which needs a lowercase follower) misses.
  tokens = s.split(' ');
  if (tokens.length >= 2 && /['’]s$/i.test(tokens[0]!)) {
    s = tokens.slice(1).join(' ');
  }

  s = s.toLowerCase().replace(/['’]s\b/g, '').replace(/\s{2,}/g, ' ').trim();
  return s || raw.trim().toLowerCase();
}

export function localParseInstacart(text: string): ParsedPantryItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !JUNK_RE.test(l));

  const out: ParsedPantryItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const isSub = SUB_RE.test(line);
    // For a substitution, the canonical item is the text after the marker.
    const subjectText = isSub
      ? line.replace(new RegExp(`^.*?${SUB_RE.source}`, 'i'), '').trim() || line
      : line;

    const canonicalName = canonicalize(subjectText);
    if (!canonicalName || canonicalName.length < 2) continue;
    if (seen.has(canonicalName)) continue;
    seen.add(canonicalName);

    const { amount, unit } = quantity(line);
    out.push({
      value: {
        canonicalName,
        amount,
        unit,
        originalInstacartText: line,
        tag: isSub ? 'sub' : 'new',
      },
      confidence: 'parsed',
    });
  }

  return out;
}
