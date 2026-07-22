# Stock

Cooking app for the Nate Apps suite. Plan-driven, recipe-aware, pantry-conscious.
Mobile-first, cross-platform (iOS, Android, web preview). Local-first, v1.

Build spec (source of truth): `../Stock artifacts/stock-spec.md`.
Visual reference mockups: `assets/mockups/*.html`.

## Stack

- Expo SDK 54 · React Native 0.81 · React 19 · TypeScript (strict)
- Expo Router (file-based) — `src/app`
- NativeWind v4 + Tailwind 3 (palette mirrors `src/design`)
- Zustand + TanStack Query (installed, not yet wired)
- expo-sqlite (local-first storage, native; web DB deferred — spec §12)
- @anthropic-ai/sdk (Claude API — spec §11)

## Run

> **Node 26 (system default) breaks Expo SDK 54.** `expo start` hangs and
> `expo export` crashes (`rnGetPolyfills`) on Node 26. Node 22 LTS is
> installed keg-only at `/opt/homebrew/opt/node@22`; **every** `dev:*` /
> `build:*` / `serve:web` script forces it (system default untouched).
> Also: `npx`/`npm exec` itself hangs in non-TTY shells — use the npm
> scripts or call local bins via `node` directly. Run these in a real
> terminal or a fresh session.

```bash
npm install
cp .env.example .env        # add EXPO_PUBLIC_ANTHROPIC_API_KEY (spec §14.2)

# Hot-reload dev — run in a REAL terminal:
npm run dev:web             # http://localhost:8088, Fast Refresh
npm run dev:ios             # simulator

# Static build + serve (headless/agent or quick look):
npm run serve:web           # export to dist/ then serve on :8088 (no reload)
                            # if it hangs/cache-errors:  npm run serve:web -- --clear

npm run typecheck           # node tsc, pinned to node@22 — NEVER `npx tsc` (npx hangs)
                            # (system Node 26 makes tsc emit phantom "Cannot find
                            #  global type Object/Number/Boolean" lib errors + zero-
                            #  output hangs; the script forces node@22 like the rest)
```

> ⚠️ Don't `kill -9` Metro repeatedly — orphaned workers become zombies that
> brick all Node tooling for the session. If exports start hanging with zero
> output, the fix is a fresh session/reboot, not retries.

## Layout (spec §13)

```
src/
  app/            Expo Router screens — (tabs)/ is the 5-pillar nav
  components/     UI primitives (Text, Glyph, Card, Screen) + design system
  lib/
    api/          Claude API wrapper (cache + model routing — §11)
    db/           SQLite schema, client, repositories (§4)
    parsing/      recipe / instacart / units stubs (§11 tasks)
  design/         palette, typography, glyph tokens (§2) — source of truth
  types/          domain types transcribed from spec §4
assets/
  mockups/        HTML visual reference
  fonts/          (Iowan/JetBrains fallbacks — to add)
```

## Sharing a kitchen (household)

Two people who live together use **one kitchen from two logins**: same recipes,
pantry, plan, cook plans, and shopping list, live on both phones. Sign in →
**Share this kitchen** → enter their email. They sign in with their own email
and their own code; nothing is shared with anyone you haven't added.

How it works, in one line: the client resolves an **effective owner id** at
sign-in (`src/lib/household.ts`) and every read, write, and Realtime filter in
`src/lib/sync.ts` keys off *that* instead of the signed-in uid, so both accounts
converge on one set of rows. RLS on the eight kitchen tables was widened from
`auth.uid() = user_id` to `user_id in (select public.stock_owner_ids())`
(`supabase/migrations/20260722000000_household_sharing.sql`).

Worth knowing:

- Membership is keyed by **email, not uid**, so you can add someone before they
  have ever opened Stock — they're in the household the instant they first sign
  in, with no window where their writes land in a private silo.
- **Calories are not shared.** Cooks push to `tide_intake_logs` under the
  signed-in account, so each person logs to their own Tide/Trim day.
- Only the **owner** seeds an empty kitchen from local data. A member joining
  adopts the kitchen rather than bulk-uploading whatever they had in local-only
  mode into someone else's pantry.
- Adding someone takes effect on their **next app open** — if they're already
  signed in, have them reload.
- Removing them is one row; their own kitchen is untouched.

## Build status (spec §13 order)

| Pillar | State | Verified |
|---|---|---|
| Scaffold / design system / nav | ✅ | tsc + web bundle (clean) |
| Recipes §6 (library, detail, capture flow, parser) | ✅ | tsc clean |
| Cook §7 (Focused, Glance, timers, scrub, post-cook) | ✅ | tsc clean |
| Plan §5 (week grid, picker, shopping list) | ✅ | tsc clean |
| Pantry §10 (list, status cycle, Instacart paste, cycles) | ✅ | built |
| Pipeline §8 (ideas → recipe) | ✅ | built |
| Bench §9 (Convert grams + baker's %, Sub) | ✅ | tsc clean + web export |
| Mod history | ✅ | in recipe/cook diffs |

All five pillars are now built (Bench was the last `PillarPlaceholder`).
Remaining Claude tasks still stubbed in `lib/parsing/recipe.ts` (throw "not
implemented"): §11.3 YouTube-transcript inference, §11.8 timer/temp detection,
§11.9 step-title generation, §11.10 recipe→pipeline keyword matching.

**First thing in a new session:** `npm run typecheck` (Plan §5 was written but
its typecheck couldn't run last session — fix anything it flags), then
`npm run dev:web` (your terminal) or `npm run serve:web` (agent) to preview.

> **2026-05-18 — root cause found, post-reboot resume:** the typecheck "couldn't
> run" because the `typecheck` script was the *only* npm script not pinning
> node@22; under system Node 26 tsc emitted 5 phantom global-lib errors
> (`Object`/`Number`/`Boolean`/`CallableFunction`/`NewableFunction`) and then
> hung with zero output (the documented Node-zombie state — reboot, don't retry).
> Fixed: `typecheck` now forces node@22. **After the reboot, just run
> `npm run typecheck`** — no Plan §5 code error has been observed yet; the lib
> errors were environment, not source. If it's now clean, Plan §5 is verified —
> mark it ✅ and proceed to Pantry §10. If real errors in Plan §5 files appear
> (`src/app/plan-picker.tsx`, `src/app/shopping.tsx`, `src/lib/week.ts`,
> `src/lib/shopping.ts`, `src/store/plan.ts`), fix those, then `npm run dev:web`.

Stores: `src/store/` (recipes, cooks, plan — zustand; web-seeded in-memory,
native SQLite). Open build decisions: spec §14.
