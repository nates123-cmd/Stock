/**
 * Duplicate detection for the recipe library.
 *
 * WHY THIS EXISTS
 *
 * The library ended up with the same recipe stored twice, and the shape of the
 * damage explains the rules below. Two import batches collided:
 *
 *   May 29  ids `rec_<slug>`, source url the BARE ORIGIN `cooking.nytimes.com`,
 *           titles compressed to keywords — "Sheet-Pan Feta Chickpeas Tomatoes"
 *   Aug 31  ids `rec_nyt_<nytId>-<slug>`, full deep url, full editorial title —
 *           "Sheet-Pan Feta With Chickpeas and Tomatoes"
 *
 * The second import could not see the first: the ids differ, and the May rows
 * carried no deep url to compare against. So neither of the two obvious keys
 * worked alone, and ~10 recipes doubled.
 *
 * THE RULES, and why each is drawn where it is:
 *
 *   1. Deep url equality. Two recipes at the same canonical url are the same
 *      recipe. The BARE ORIGIN MUST BE IGNORED — 25 recipes share the literal
 *      url "https://cooking.nytimes.com" and 14 share "brianlagerstrom.com".
 *      Matching on those would collapse a quarter of the library into one row.
 *      This is the single most dangerous mistake available here.
 *
 *   2. Title token-set equality, after dropping punctuation and connective
 *      words. This is what bridges "Creamy Spicy Tomato Beans Greens" and
 *      "Creamy, Spicy Tomato Beans and Greens". Over the real 331-recipe
 *      library this rule fires on exactly the 4 known-bad pairs and nothing
 *      else.
 *
 *   3. Id slug equality, ignoring the `rec_` / `rec_nyt_<digits>-` prefixes.
 *      Cheap, and independently catches the same batch collision.
 *
 * Anything WEAKER than these — partial token overlap — is deliberately NOT a
 * duplicate. "Pasta Salad" and "Tapenade Pasta Salad" overlap heavily and are
 * different recipes; so are "Steak Salad" and "Blackened Tri-Tip Steak Salad".
 * Those are surfaced as REVIEW CANDIDATES for a human to judge (see
 * `findDuplicateCandidates`), never merged automatically.
 */
import type { Recipe } from '@/types';

/** Connectives and marketing words that carry no identity for a recipe title. */
const STOP = new Set([
  'with', 'and', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'or', 'to',
  'recipe', 'recipes', 'easy', 'best', 'style', 'simple', 'quick', 'classic',
  'my', 'our', 'homemade',
]);

/**
 * The comparable identity of a title: lowercased, punctuation stripped,
 * connectives dropped, SORTED so word order can't hide a match. Returned as a
 * Set for the candidate scorer and as a joined string for exact keying.
 */
export function titleTokens(title: string | undefined): Set<string> {
  const words = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w));
  return new Set(words);
}

export function titleKey(title: string | undefined): string {
  return Array.from(titleTokens(title)).sort().join(' ');
}

/**
 * The recipe's canonical url, or null when it carries none that identifies a
 * SPECIFIC recipe.
 *
 * Returns null for an origin-only url. See rule 1 above — this guard is the
 * whole reason the function exists rather than reading `source.url` directly.
 */
export function canonicalUrl(r: Pick<Recipe, 'source'>): string | null {
  const raw = r.source?.url?.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  // Strip a trailing slash, then require at least one real path segment.
  const path = u.pathname.replace(/\/+$/, '');
  if (!path || path === '/') return null;
  // Query strings on recipe urls are tracking noise; the path is the identity.
  return `${u.host.replace(/^www\./, '')}${path}`.toLowerCase();
}

/** The identity part of a generated recipe id, minus import-batch prefixes. */
export function idSlug(id: string): string {
  return id
    .replace(/^rec_nyt_\d+-/, '')
    .replace(/^rec_/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

export type DupeReason = 'url' | 'title' | 'slug';

export type DupeMatch = {
  existing: Recipe;
  reason: DupeReason;
};

/**
 * Is `candidate` already in `library`? High-confidence rules only — a hit here
 * is safe to skip on import without asking.
 *
 * A recipe never matches itself: an edit re-saving an existing id is not a
 * duplicate, which is what keeps this usable inside the normal save path.
 */
export function findDuplicate(
  candidate: Pick<Recipe, 'id' | 'title' | 'source'>,
  library: Recipe[],
): DupeMatch | null {
  const url = canonicalUrl(candidate);
  const tkey = titleKey(candidate.title);
  const slug = idSlug(candidate.id);

  for (const existing of library) {
    if (existing.id === candidate.id) continue;

    if (url) {
      const eUrl = canonicalUrl(existing);
      if (eUrl && eUrl === url) return { existing, reason: 'url' };
    }
    // An empty title key would match every other untitled recipe.
    if (tkey && titleKey(existing.title) === tkey) {
      return { existing, reason: 'title' };
    }
    if (slug && idSlug(existing.id) === slug) {
      return { existing, reason: 'slug' };
    }
  }
  return null;
}

export type DupeCandidate = {
  a: Recipe;
  b: Recipe;
  /** Token-set Jaccard, 1 = identical identity words. */
  score: number;
  /** True when a high-confidence rule fires — safe to merge without thought. */
  certain: boolean;
  reason: DupeReason | 'similar';
};

/**
 * Every pair worth a human's attention, strongest first.
 *
 * Used by the duplicate-review screen. Deliberately includes weak matches that
 * `findDuplicate` refuses, because a person looking at two titles side by side
 * can tell "Pasta Salad" from "Tapenade Pasta Salad" and this function cannot.
 */
export function findDuplicateCandidates(
  library: Recipe[],
  minScore = 0.6,
): DupeCandidate[] {
  const prepared = library.map((r) => ({
    r,
    tokens: titleTokens(r.title),
    url: canonicalUrl(r),
    slug: idSlug(r.id),
  }));

  const out: DupeCandidate[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const A = prepared[i]!;
      const B = prepared[j]!;
      if (!A.tokens.size || !B.tokens.size) continue;

      let inter = 0;
      for (const t of A.tokens) if (B.tokens.has(t)) inter += 1;
      const union = A.tokens.size + B.tokens.size - inter;
      const score = union === 0 ? 0 : inter / union;

      let reason: DupeCandidate['reason'] | null = null;
      if (A.url && B.url && A.url === B.url) reason = 'url';
      else if (score === 1) reason = 'title';
      else if (A.slug && A.slug === B.slug) reason = 'slug';
      else if (score >= minScore) reason = 'similar';

      if (!reason) continue;
      out.push({
        a: A.r,
        b: B.r,
        score,
        certain: reason !== 'similar',
        reason,
      });
    }
  }
  // Certain matches first, then by how alike the titles are.
  return out.sort(
    (x, y) => Number(y.certain) - Number(x.certain) || y.score - x.score,
  );
}

/**
 * Which of two duplicates to keep: the one carrying more recoverable content.
 *
 * Scored rather than "newest wins" because the May batch is older AND thinner,
 * but a recipe Nate has since cooked from and annotated must outrank a fresh
 * import even if that import is prettier.
 */
export function richer(a: Recipe, b: Recipe): Recipe {
  const score = (r: Recipe) =>
    (canonicalUrl(r) ? 4 : 0) +
    (r.imageUrl ? 2 : 0) +
    (r.myNotes?.trim() ? 3 : 0) +
    (r.cookCount ?? 0) * 3 +
    (r.isFavorite ? 2 : 0) +
    (r.isToTry ? 1 : 0) +
    Math.min((r.steps?.length ?? 0), 20) +
    Math.min((r.ingredients?.length ?? 0), 20);
  return score(b) > score(a) ? b : a;
}
