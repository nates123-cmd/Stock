# Stock — QA test harness plan

Additive only. Tests import and call the REAL shipped modules from `src/`
(via the `@/*` alias). No app source or build config was changed. Runner:
**Vitest** (added as a devDep; `npm test` → `vitest run`). Node 22 required for
the full toolchain (Expo SDK 54); Vitest itself runs on any modern node, but
the install was done under `node@22` to stay consistent with the repo.

## What is NOT covered (and why)

- **React-Native components / screens** (`src/components`, `src/app/**`):
  RN-web + expo-router + nativewind need the Metro/Expo bundler, which is the
  exact thing that is fragile in this harness. Out of scope; the high-value
  bugs live in pure logic, not JSX.
- **Live Claude calls** (`callClaude`, `claudePdf`, `claudeImage` actually
  hitting Anthropic/the proxy): network + secret key. We test the parsers that
  shape Claude's *output* (`extractJson`, `mapRaw`) and the gate that decides
  whether Claude is even reachable — not the wire call.
- **Live Supabase / Tide push round-trip**: needs auth + a real DB. We test
  `pushCookToTide`'s decision logic and payload shape by injecting a mocked
  supabase client (`vi.mock`), which is where the real risk is (payload shape,
  idempotent delete, fire-and-forget swallow).
- **IndexedDB / SQLite persistence** (`src/lib/db/**`): the web store uses
  `idb-keyval` (real IndexedDB) and native uses `expo-sqlite`; neither loads
  cleanly outside the bundler. The risk here is integration, not pure logic —
  left for a browser smoke test (deferred; see below).
- **Playwright web smoke**: OPTIONAL per brief. `serve:web` requires a full
  `expo export` web build under node@22 in a TTY — slow and flaky in this
  harness. Deferred; not blocking. The unit tests are the high-value catch.
- **Stubs**: `findSubstitutes`, `inferRecipeFromTranscript`,
  `detectTimersAndTemperature`, `generateStepTitle`, `matchPipelineKeywords`
  all `throw "not implemented"`. We assert that contract (so a future
  implementation that silently returns junk is noticed) but don't test logic
  that doesn't exist.

## Risk-ranked coverage (highest first)

1. **Stock→Tide push payload** (`src/lib/tide.ts::pushCookToTide`) — HIGH.
   The whole point of the patch (#0cdbce11) was that macros must be nested in
   `metadata` with `category='food'` or Tide never sees the cook. Tests cover:
   payload shape (kcal/macros scaled by servings, nested in metadata),
   `source_id` = cook.id for idempotency, the pre-insert delete, and all four
   early-return guards (no-supabase / no-nutrition / not-signed-in / error
   swallow). Mocks the supabase client.

2. **JSON-LD recipe extraction** (`src/lib/parsing/jsonld.ts`) — HIGH.
   Primary import path for real sites (NYT etc). Tests: `@graph` traversal,
   `recipeIngredient` array kept verbatim (NOT comma-split), `HowToStep` /
   `HowToSection` flattening, ISO-8601 duration → minutes, nutrition
   extraction, publisher/author resolution, multi-line string steps,
   returns null when ingredients/steps missing, malformed block tolerance.

3. **Local heuristic recipe parser** (`src/lib/parsing/localRecipe.ts`) —
   HIGH. The keyless fallback (no Claude). Tests: quantity parsing (unicode
   fractions, mixed numbers, `a/b`), unit synonym normalization, the
   "6 servings" / "Serves 6" / two-line NYT yield cases NOT becoming
   ingredients, confidence flags.

4. **Instacart receipt parser** (`src/lib/parsing/localInstacart.ts`) — HIGH.
   Pantry import. Tests: multi-pack math (`6 oz × 2`, `2 × 6 oz`), junk-line
   filtering, substitution → arrived-item, brand strip, dedupe, unit normalize.

5. **CLAUDE_AVAILABLE gate** (`claudeBridge.ts` native + `.web.ts`) — HIGH.
   Single source of truth for whether AI features show. Tests both: native
   gate keys on `EXPO_PUBLIC_ANTHROPIC_API_KEY`, web gate keys on
   `EXPO_PUBLIC_CLAUDE_PROXY_URL`, via fresh module imports with env set/unset.

6. **Recipe output shaping** (`src/lib/parsing/recipe.ts`) — MED/HIGH.
   `detectSource` (NYT/known-host/generic/bad-URL), `extractJson` (markdown
   fence strip, embedded prose, throws on no-JSON), nutrition mapping
   (`source:'estimated'`, null→undefined), serves clamp to 4.

7. **Macro/number display** (`src/lib/format.ts`) — MED.
   `toFraction` (culinary fraction snapping, integer passthrough, no-fake on
   odd values), `formatAmount` (tight short units, pc), `formatMinutes`,
   `relativeAge`.

8. **Best-guess parser** (`src/lib/parsing/localBestGuess.ts`) — MED.
   Free-text → ingredients, always `guessed`, comma + newline splitting.

9. **Cache key** (`src/lib/api/claude.ts::cacheKey`) — LOW. Deterministic,
   stable, task+input sensitive.
