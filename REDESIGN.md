# Stock — Plan/Cook flow redesign

Locked flow from Nate's 8 notes (2026-07-07). Source of truth for the branch.
Design mockup: the Plan/Cook 3-tab prototype (Recipes · Plan · Cook + global cart-+).

## Navigation — 3 tabs (was 5)

`Recipes · Plan · Cook`, plus a **global floating cart-+ FAB** over every tab.

- **Recipes** — segmented `Favorites / To Try / All`.
  - **To Try** = mixed-type capture bin (absorbs the old Pipeline tab): holds an
    idea, a bare ingredient, a link/video (unparsed), or a full recipe. Each item
    carries a `kind` chip and **graduates**: idea→recipe, ingredient→shopping,
    link→parse-to-recipe, recipe→add-to-plan / favorite.
  - **Favorites** = recipes flagged `isFavorite`.
- **Plan** — segmented `Plan / Shop / Pantry`.
  - **Plan** view has two layouts, user toggles, choice persists:
    - horizontal day-chips (tap a day → its meal), and
    - vertical agenda scroll, **anchored today-forward** (today on top, future below).
  - **Shop** = the shopping list, promoted here with an always-on jot bar at top.
  - **Pantry** = have / low / out; low+out surface onto Shop.
- **Cook** — whole-meal launcher (Cook Plans). Opens contextually to the relevant
  meal, shows its dish(es), offers **Combine**. **Bench** (scale/convert/sub) folds
  in here — no longer its own tab.

**Global cart-+ FAB:** tap → capture sheet defaulting to **Shopping** (type+enter,
done). Chips redirect to **To Try** or **New recipe**. Cart glyph, not a bare + (so
it doesn't misread as "new recipe"). Mounted once in `(tabs)/_layout`, not per-screen.

## Plan / meal model (note 2)

**Day → Meals[] → Meal.dishes[]**. A dish = a recipe (or a To-Try item / experiment).

- Adding dishes to a day **merges into ONE meal by default**. Optional: split by meal
  type (lunch/dinner) when wanted. No forced breakfast/lunch/dinner labeling; context
  implies. (Was: one recipe per PlanEntry — this is a model change.)

## Cook combine — timeline merge (note 2)

From Cook, **Combine** = merge the dishes' step lists into ONE back-scheduled
procedure anchored to serve time, make-ahead aware:
`T-24h marinate chicken → T-1h start rice → T-20m sear → serve`.
Spans days, not just the cooking window. Almost certainly **Claude-generated**
(reads all dishes' steps, interleaves + back-schedules via the existing Claude proxy).
Follow-on (not v1-blocking): a **nudge** for make-ahead steps ("marinate tonight").

## Shopping (notes 3–7)

### Cart combine — dedup review (note 5) — DISTINCT from Cook combine
When building the list, don't silently auto-consolidate. Surface each duplicate as a
one-at-a-time confirm:
`1 lemon (Shakshuka) · 1 lemon (Chana) → Combine to 2 lemons?` [Combine][Keep separate][Edit qty]
- Same-unit → auto-sum offered. Unit mismatch (1 cup + 200 ml) → offer a conversion
  (use `convert-units`). User drives; nothing merges unseen.

### Always-have (note 6) — BUG + design
Mark "salt" always-have → **never appears on any shopping list**, incl. plan→shopping.
Currently broken. Root-cause candidates: split brain between `have.ts alwaysHave` and
`pantry.ts isStaple`; name-match miss (`canonicalName` vs raw text, "Salt"≠"salt").
Fix: ONE source of truth for always-have, name-normalized, filtered from EVERY shopping
path. Ride with the proper Pantry-segment implementation (closes the "pantry pillar not
implemented" gap).

### Fast delete + suppress (note 7 → 7a)
Multiple quick removals, esp. plan-derived: swipe-left delete, check-off clears, bulk /
"clear checked", long-press multi-select. **Deleting a plan-derived item SUPPRESSES it
from future plan→shopping regen (7a — stays gone).** Swipe also offers "always have it"
(→ always-have store) for the permanent version. One suppression list, one source.

### Per-item store tag + detail (note 3)
Quick-add stays instant. **Long-press item → detail sheet** with optional fields,
primary = **store**. Stores configurable, seed: **Wegmans · Costco · Stop One**. Once
tagged, Shop view can group/segment by store. Detail also holds optional qty/brand/note.

### Fulfillment routing (note 4)
Store tag = fulfillment channel. Real flow: plan → order Wegmans via Instacart (Beelink
instacart-agent, already built) → push the rest to Apple Reminders list **"Shared
Groceries."**
- **Wegmans** → Instacart / Beelink (existing).
- **Stop One / unassigned / everything else** → Apple Reminders "Shared Groceries".
- **"Add remaining to Reminders" button** in Shop → fires an `shortcuts://` deeplink to
  an Apple Reminders Shortcut (Nate installs once; suite pattern — cf. Tick's "Add Tick
  Reminder", Course Shortcuts deeplinks). **"Remaining" = everything not tagged Wegmans**
  (Stop One + unassigned).

## Shop leads + the buy loop (follow-on, 2026-07-08)

Nate: "shopping list should lead." Shop/Pantry were already co-located as Plan-tab
segments, but the Shop + Pantry segments were `TODO(phaseD)` stubs that routed to
the standalone screens, and nothing flowed from buying into the pantry. Three deltas:

1. **Shop leads.** Plan tab segments reordered `Shop · Plan · Have` and the tab now
   opens on **Shop** (was `Plan`). "Pantry" segment renamed **Have**. The Shop and
   Have segments now embed the real screens (`<ShoppingList embedded />`,
   `<PantryScreen />`) instead of routing away.
2. **The buy loop (new).** Checking a Shop item off opens a **BuySheet** confirm
   (location Shelf/Fridge/Freezer, default by category; optional qty prefilled from
   the line) → `pantry.applyPaste()` restock-merges it in at `fine`, then the row
   leaves the buy list (into Already-have). Restock rows (low/out staples) buy the
   same way — `applyPaste` flips them back to `fine` so they drop off on their own.
   "Already had it" clears a row without touching the pantry (the old behavior).
   Closes the loop: bought → pantry → depletes to low/out → resurfaces on Shop.
3. **Standing list.** Kept the derive-per-render model (plan auto-merges + dedupes
   via `consolidateSmart`) — manual adds (`extras`), suppressions (`shopMeta`), and
   always-have (`have.ts`) already persist, so with the buy loop the list *behaves*
   standing without materializing snapshot rows (which would lose live plan sync).

Touched: `app/(tabs)/index.tsx` (embed + reorder + default), `app/shopping.tsx`
(applyPaste selector, `buying` state, `openBuy`/`commitBuy`/`skipBuy`, 4 buy-row
check-offs rerouted, `BuySheet` + `locForName`). NOT browser-verified — see PR.

## Visual (note 8) — DEFERRED to its own session
Nate: "less Claude-y." Current parchment-cream + serif + tomato IS the AI-default cliché.
This restructure keeps existing tokens as-is but is built **token-clean** (no hardcoded
colors/fonts; everything via `@/design`) so a later visual session is a `colors.ts` /
`typography.ts` swap, not a rewrite.

## Build phases
- **A** — 3-tab nav skeleton + SegmentedControl + global cart-+ capture sheet + To-Try
  (extend `PipelineIdea.kind`) + `Recipe.isFavorite`. Reshape IA over existing data.
- **B** — Plan meal model (Day→Meals→Dishes) + dual view.
- **C** — Cook back-scheduled combine timeline (Claude) + Bench folded in.
- **D** — Shopping: always-have fix, delete/suppress, cart-combine review, store tag +
  detail, Reminders routing + Shortcut.

## Open defaults (taken to keep moving; Nate can veto)
- Plan vertical mode anchors today-forward (not Mon→Sun).
- Cart combine: same-unit auto-sum; unit-mismatch offers conversion; Combine/Keep/Edit.
- "Remaining" = non-Wegmans (Stop One + unassigned).
