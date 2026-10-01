# Stock — design constraints ("Enamel")

Chosen 2026-09-30 from three directions (Enamel / Test Kitchen / Stovetop),
after Nate and Amanda's moodboard session. Replaces the parchment + serif +
tomato look that REDESIGN.md note 8 flagged as "Claude-y". Mockup:
`../Stock artifacts/enamel-mockup.html`.

Every future visual change reads this first. If a change contradicts it,
change this file in the same commit or don't make the change.

## Reference — who owns what

Four references, each answering a different question. Never averaged.

| Reference | Owns | What it contributes |
| --- | --- | --- |
| **Le Creuset** (enamel cookware) | Colour | The enamel colourways, sampled off the brand's swatch chart. Cuisine colour, and Matte Navy ink. |
| **NYT Cooking** | The library | Warm-white page, horizontal shelves, big square cards with exactly two facts, heavy rule between sections. |
| **ChefSteps** | The recipe | Title on a full-bleed hero, a geometric sans, the right-aligned gram column with italic ingredient names, circled step numerals. |
| **Kenji, _The Wok_** | Cook mode | A dark ground reserved for the moment you are actually at the stove. |

**The spine:** all four are unashamed of data. Grams, minutes, temperatures,
cook counts are shown plainly and lined up, never hidden to look calm.

**Conflicts, resolved:**
- *Ground* — NYT white vs Wok black. White wins everywhere except cook mode.
- *Type* — NYT serif vs ChefSteps sans. Sans wins: Stock is read with wet
  hands at arm's length.

## Register

Approachable kitchen, not a food magazine. Confident, a little loud in colour,
quiet in chrome. **Test: if a change makes it feel more like a lifestyle
magazine (serifs, beige, soft shadows, italics for mood), it is wrong.**

## The motif — enamel tiles

Most recipes have no photo. Each one is "cast" in its cuisine's Le Creuset
enamel, with two lid rings cropped off the tile (`EnamelTile`). Ring position
is hashed from the recipe id so neighbours never look like the same
placeholder. With a photo, the photo wins and the enamel is just the loading
colour.

Cuisine → enamel lives in `src/design/enamel.ts`. Families share a colour on
purpose (nine enamels for twenty cuisines):

| Enamel | Hex | Cuisines |
| --- | --- | --- |
| Artichaut | `#28463C` | italian |
| Marseille | `#05569D` | french, british, german, eastern european |
| Rhône | `#5D0A11` | spanish |
| Caribbean | `#067D96` | greek, caribbean, american |
| Nectar | `#E59307` | middle eastern, north african |
| Olive | `#5B5216` | indian, mexican, latin american |
| Cerise | `#B90505` | chinese, korean |
| Azure | `#27578F` | japanese |
| Sage | `#80A29A` | thai, vietnamese |
| Sea Salt | `#72898B` | other / not set |

Chambray was tried for American and dropped: it reads as drab grey.

## Colour tokens (`src/design/colors.ts`)

Token names were kept from the parchment era so the swap reached every screen.

| Token | Value | Role |
| --- | --- | --- |
| `bg` | `#FBF9F4` | warm-white ground |
| `bg2` | `#F2EEE5` | recessed: search, segment track, secondary buttons |
| `bg3` | `#E8E2D5` | deeper recess |
| `bgCook` | `#122131` | cook-mode ground (Matte Navy) |
| `accent` | `#CE3A07` | **Flame — actions only** |
| `accentDeep` | `#A82F05` | pressed |
| `text` | `#122131` | Matte Navy ink |
| `textMuted` | `#4A5563` | prose secondary |
| `textFaint` | `#79818B` | data / chrome tier: meta lines, placeholders |
| `line` | `#E3DDD0` | hairlines |
| `ok` | `#2F6B4F` | success |
| `warn` | `#B86F00` | attention, **and modified amounts** |
| `cookText` / `cookMuted` / `cookLine` | | ink on navy |

**Flame is the one action colour.** Buttons, links you tap, the active tab,
the timer you can start. Nothing decorative, nothing informational. A modified
amount is information, so it is `warn`, not Flame. An auto-assigned tag is
information, so it is a dashed ink outline, not Flame.

### Cook mode ink (`src/design/ink.tsx`)

Cook screens wrap themselves in `<InkProvider ink="cook">`. `Text`, `Glyph`,
`Card`, `Button`, `TimerStrip` and `StepBody` resolve the *same token names*
against the cook palette, so `text` is cream there. `Overlay` resets to
`light`: a sheet is always warm white. Module-level StyleSheets on a cook
screen use `palette('cook')` (`cc.*`) for main-surface colours and plain
`colors.*` for anything inside a sheet.

## Type (`src/design/typography.ts`)

One face: **Figtree** (standing in for ChefSteps' Circular), self-hosted from
`public/fonts` via `@font-face` in `global.css`, so it works offline.
Hierarchy comes from size and weight, 11 → 40px and 400 → 800.

| Variant | Size / weight | Job |
| --- | --- | --- |
| `screenTitle` | 36 / 800, tight | screen titles, recipe hero title (34) |
| `recipeTitle` | 18 / 700 | section heads ("Ingredients" at 24/800) |
| `body` / `bodyStrong` | 15 / 400, 600 | prose, list titles |
| `sectionLabel` | 11 / 700 caps, +1.4 | shelf names, fact labels |
| `numeric` | 13 / 700, **tabular** | every number |
| `cookStepTitle` / `cookBody` | 32 / 800, 21 / 400 | arm's length |

Ingredient names are italic 500. Nothing else is italic except notes.
`fonts.serif` and `fonts.mono` are aliases of Figtree kept for old call sites.
Do not reintroduce a serif or a monospace face.

## Devices — reach for these first

- **Hairline rows** to divide lists. Not bordered cards.
- **Underline tabs** (`SegmentedControl`): ink label, Flame underline. No pills.
- **The heavy ink rule** (2px `text`) above a major section ("All recipes").
- **Shelves**: horizontal rows of 148px `ShelfCard`s, bled to the screen edge,
  "All N" link right. Only on the unfiltered All view; max 4 shelves x 8 cards.
- **Facts strip**: three cells split by hairlines, big tabular number over a
  caps label.
- **Gram column**: amounts right-aligned in a fixed 76px column.
- **Circled numerals** for steps (30px, 1.5px ink ring).
- **6–10px corners.** Pills (999) only for small toggles and filter chips.

## Banned

- Parchment / beige grounds, espresso-brown ink, tomato red.
- Serif display type. Monospace for numbers.
- Bordered rounded cards as the default way to group a list.
- Flame on anything that isn't an action.
- An empty grey square where a recipe has no photo (use `EnamelTile`).
- Drop shadows (the FAB keeps one), gradients, Unicode ★ as a rating.
- Inter / Roboto / Space Grotesk / Poppins / system stack as the face.

## Honesty rules that outrank the design

- Times stay `~`-prefixed: they are estimates and the data says so.
- Modified amounts keep the struck-through original beside the new value.
- The duplicate count stays on the library header until it reaches zero.
- Shelves never hide a recipe: everything is still in "All recipes" below.

## Looking at it

The web build seeds IndexedDB with three recipes on first run, no sign-in.

1. `npm run build:web`, then `ln -sfn . dist/Stock` and
   `python3 -m http.server 8089 --directory dist`.
2. Open `http://127.0.0.1:8089/Stock/` (deep links 404 on the plain server).
3. Phone width: replace the page body with a same-origin 390x844 `<iframe>`
   of `/Stock/`, and drive it with JS `.click()` on elements found by text.
4. Three seed recipes don't show shelves. For a realistic library, write
   cloned recipes into idb-keyval (`keyval-store` / `keyval`, key
   `stock:recipes`, plus `stock:cooks` for "Cooked lately"). Set `cuisine`
   without `cuisineAuto`, or the tagger re-derives it.
