# Plan → Shopping List: the build wizard

Status: SPEC + in progress (2026-07-16). Owner: Nate.

## Why

Today the Active shopping list is **live-derived** from the week's planned meals
on every render: `plan → recipes → consolidate → filter → rows`. That design is
the source of the recurring frustration:

- **Things keep appearing.** As long as a meal is planned, its ingredients are
  candidates every render. Anything that "removed" a row is a filter that can
  miss (name-keyed exclusion vs a renamed consolidation line; a session-only
  dismissal; a pushed timer). The list regenerates from the plan and fights you.
- **Deleting doesn't always stick.** Delete = *suppress by name*. When the
  (non-deterministic) consolidation renames the line, the suppression key no
  longer matches and the item comes back as "new."

The fix is architectural: **stop live-deriving.** A wizard builds the shopping
list ONCE from a reviewed pass over the plan, writes concrete rows, and from
then on the list is a **materialized, committed list** — deleting a row just
deletes it; nothing regenerates it from the plan. Rebuild = re-run the wizard.

## The flow

**0. Pick recipes.** A checklist of every recipe in the plan (in scope = the
current week's planned meals). All checked by default. Uncheck any you're not
shopping for. Continue walks only the selected recipes.

**1. Per selected recipe — Shop for / Already have.** One step per recipe. Its
ingredients split into two sections:
- **Shop for** — you don't have it: pantry `out` or absent.
- **Already have** — pantry covers it: `fine` or `low`. **Running-low (`low`)
  items sort to the TOP** of this section (you have them, but barely — one tap
  to bump into Shop-for).

Editable at each step: move an item between sections, adjust qty, remove it.
Marking an item **"always have"** writes a **pantry staple** (global — it reads
as Have for every recipe from now on; NOT a per-recipe note). This is the only
per-item state that persists; there is no per-recipe edit memory.

**2. Combine.** After the last recipe, one screen to merge duplicate ingredients
across the selected recipes ("2 onions" + "1 onion" → "3 onions"). Reuses the
existing combine logic, as a dedicated step instead of a background suggestion.

**3. Done → the shopping list.** The wizard's result (the combined Shop-for
items) is written to the **shopping list** as concrete rows. The wizard does NOT
push to any cart.

**4. Push (unchanged).** From the shopping list you push to Wegmans / Costco /
Amazon / Reminders exactly as today. The push code reads the same rows.

## Architecture: materialized list, not live derivation

- The wizard writes a **committed list** (a new persisted store, e.g.
  `useShoppingListStore` with concrete `{id, name, qty, source}` rows). These
  rows have stable ids — delete removes by id, edit updates by id. No plan
  re-derivation touches them.
- The **push surface stays**: Wegmans/Costco/Amazon/Reminders read from the
  committed rows (same selection/push code, just a different row source).
- **Staples** fold in: standing always-have items that are `low`/`out` are
  offered in the build (and still show on the Staples segment as today).
- **Rebuild:** re-running the wizard re-materializes. A plan change no longer
  silently mutates the list — you rebuild when you want to.

### What this RETIRES from the current flow

(To be finalized from the current-flow analysis — see below.) Candidates:
- The live `consolidateSmart`/`consolidateLocalSmart` → `items` → `visibleItems`
  → `activeRows` derivation as the SOURCE of Active.
- The name-keyed exclusion machinery that only exists to fight the derivation:
  `shopMeta.suppressed` (delete = suppress), session `dismissed`, and the
  `shop-consolidation` persist-cache stopgap.
- Pushed no longer needs to be an Active exclusion; it's a post-list state.
- Kept: extras (manual adds), the combine logic, the push agents, Staples.

## Current flow being replaced (grounded analysis)

The Active list is **100% live-derived on every render** — no materialized rows:
`planMeals → weekRecipes (shopping.tsx:409) → consolidateLocalSmart then
consolidateSmart (Claude) → items (useEffect :429) → visibleItems (:467, minus
dismissed + suppressed) → allRows/activeRows (:684) minus gone() = inHave ||
wasPushed`.

**Two things add a row to Active:** recipe ingredients (via the consolidation)
and extras (manual/pipeline adds). Pantry low/out restocks are NOT on Active —
they go to Staples.

**Why delete / handled doesn't always stick (the whole reason we're replacing
this):**
1. **Delete = suppress by NAME.** `deleteItem` → `suppress(matchKey(i.name))`.
   But `i.name` is the consolidation output, and Claude vs the local fallback
   emit different names ("pistachio" vs "pistachios", "lemon" vs "lemons").
   Suppression matches ONLY exact matchKey (no base-noun fallback), so a rename
   after you delete → the row reappears. (PR #7's `planSig` persist freezes
   names per unchanged plan, which HELPS, but the local↔Claude first-pass
   mismatch + any plan change still leak.)
2. **Session-only `dismissed`** (restock deletes, some hides) — lost on reload.
3. Timers, now fixed: 6h "have" expiry (→ permanent, PR #3), pushed 48h→24h→
   **permanent** (PR #7).
4. **The recipe is still planned**, so its ingredient is a candidate every
   render. Nothing but a name-keyed suppression stands between the plan and the
   row — and that suppression is fragile (see #1).

**Push reads from `selectedRows`/`currentRows`** (shopping.tsx:931) — so a
materialized list that produces the same `FlatRow[]` shape feeds
`pushToWegmans`/`pushToReminders`/`copyAndOpen` unchanged.

**Conclusion:** the leaks are inherent to deriving a list from the plan every
render and fighting it with name-keyed exclusions. A **materialized list** (the
wizard writes concrete rows with stable ids; delete removes by id; nothing
re-derives) removes the entire failure class.

## Build order

1. **Wizard scaffold + entry.** "Build shopping list" on the Plan tab → a new
   route `plan-shop/` (stepper). Step 0 = recipe checklist (planned recipes,
   all checked, deselectable).
2. **Per-recipe Shop/Have step.** Pantry-driven split; `low` floated to the top
   of Have; move/qty/remove; "always have" writes a pantry staple.
3. **Combine step.** Reuse combine logic as a screen.
4. **Materialize + hand-off.** Write committed rows to the new shopping-list
   store; point the shopping list at it; retire the live auto-derive.
5. **Reconcile push + Staples** against the committed list.

Ship phase by phase; keep the app working at each step (the current derived list
stays until phase 4 flips the source).
