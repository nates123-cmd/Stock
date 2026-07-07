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
