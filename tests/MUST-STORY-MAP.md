# Must-story → test-type map

Maps every **Must**-priority story in `Stock artifacts/stock-user-stories.html`
to how it gets tested. Three lanes:

- **Vitest** — pure logic, no DOM/Claude. Runs in CI in ms. *Autonomous.*
- **Playwright** — UI flow against the web build (`serve:web`). *Autonomous, heavier.*
- **Manual** — visual feel or external auth/Claude; lives in the HTML doc's checkboxes.

Stories often split: the *logic* half is Vitest, the *flow/render* half is Playwright.

| Story | What | Lane | Status |
|---|---|---|---|
| CAP-01 | URL capture flow | Playwright + Vitest(jsonld) | jsonld extraction covered (`jsonld.test`); flow = Playwright TODO |
| CAP-02 | text paste parse | **Vitest** | ✅ covered (`localRecipe.test`) |
| CAP-05 | review screen editable | Playwright | TODO |
| CAP-07 | library search/sections | Playwright | TODO |
| CAP-08 | filter chips + tag AND | Playwright | TODO (filter predicate extractable → Vitest later) |
| CAP-09 | annotated detail / mod annotation | **Vitest** + Playwright | ✅ logic covered (`isModified`/`modCount`); render = Playwright TODO |
| PLAN-01 | today-first week ordering | **Vitest** | ✅ covered (`startOfWeek`/`weekDays`/`isPastWeek`) |
| PLAN-02 | pin recipe to a day | Playwright | TODO |
| PLAN-05 | swipe-delete a meal | Playwright | TODO |
| PLAN-06 | picker tabs + pantry filters | Playwright + Vitest | ✅ have-most logic covered (`recipeCoverage`/`canMakeNow`); tabs = Playwright TODO |
| PLAN-07 | live plan totals | Playwright | TODO (count compute trivial) |
| PLAN-08 | shopping list categorization | **Vitest** | ✅ covered (`categorizeIngredient`/`CATEGORY_ORDER`) |
| PLAN-09 | pantry subtracted from buy list | **Vitest** + Playwright | ✅ coverage logic covered; out/low *tags* = Playwright TODO |
| PLAN-10 | inverted-polarity have toggle | Playwright | TODO |
| COOK-01 | auto-route Focused/Glance | Playwright | TODO (rule inline in screen; extract to unit later) |
| COOK-02 | focused step-by-step | Playwright + **Vitest** | ✅ step parse covered (`durationToSeconds`/`tokenizeStep`); nav = Playwright TODO |
| COOK-03 | wake-lock keeps screen awake | Manual | platform API |
| COOK-07 | glance mode scan | Playwright | TODO |
| COOK-08 | post-cook capture | Playwright + **Vitest** | ✅ Tide payload covered (`tidePush.test`); flow = Playwright TODO |
| PANT-01 | sectioned list + running-low | Playwright | TODO (sort predicate extractable) |
| PANT-02 | tap to cycle status | Playwright | TODO (store action — unit-testable via store) |
| PANT-06 | Instacart paste parse | **Vitest** | ✅ covered (`localInstacart.test`) |
| PANT-07 | restock merge / brand strip / multipack | **Vitest** | ✅ covered (`localInstacart.test`) |
| PIPE-01 | fast idea capture | Playwright | TODO |
| PIPE-02 | ideas by status tabs | Playwright | TODO |
| BENCH-01 | convert → grams + baker's % | Manual / integration | Claude-driven (§11.4); no deterministic local path |
| BENCH-03 | ranked substitutes | Manual / integration | Claude-driven (§11.5) |
| AI-01 | guessed content flagged | Manual + Vitest | visual; `confidence.ts` flag logic extractable → Vitest later |
| SYS-01 | five-pillar bottom nav | Playwright | TODO |
| SYS-02 | local persistence across reload | Playwright | TODO (strong autonomous candidate — reload assertion) |
| SYS-03 | suite OTP sign-in | Manual / external | real auth |
| SYS-06 | no emojis / design system | **Vitest** + Manual | ✅ emoji-in-source scan covered; palette/feel = Manual |

## Tally (32 Must stories)

- **Logic now under automated test (Vitest): 10** stories have their logic
  criteria covered — 6 fully (CAP-02, PLAN-01, PLAN-08, PANT-06, PANT-07, SYS-06),
  4 partial where the flow/render half remains for Playwright (CAP-09, PLAN-09,
  COOK-02, COOK-08), plus PLAN-06 (have-most). Two **Should** stories also
  covered: PLAN-13 (grade folding), PANT-08 (cycle learning).
- **Playwright TODO: ~16** — UI flows. Best next autonomous batch: SYS-02
  (reload persistence), PLAN-10 (polarity toggle), PLAN-02 (pin), SYS-01 (nav).
- **Manual-only: ~5** — COOK-03 (wake-lock), BENCH-01/03 (Claude), SYS-03 (auth),
  AI-01 (visual). These stay in the HTML doc's checkboxes.

## What this run covered

`tests/stock-must-logic.test.ts` — 23 assertions, all green. Exercises the real
shipped modules (`shopping`, `week`, `pantry`, `recipe`, `cookText`) for the
logic criteria above.

### Harness note (why `vitest.config.ts` changed)
The unit harness (vite SSR) can't parse the **native** Claude bridge graph
(`claudeBridge.ts → claude.ts` Anthropic SDK + `cache.ts` `typeof import()` +
native SQLite). Added a test-only alias so `@/lib/api/claudeBridge` resolves to
the lean **web** bridge (`claudeBridge.web.ts`, fetch-only) — exactly how the
shipped web build resolves it. No app source touched.

### Findings surfaced
- `recipe.test.ts` has 2 **stale** failures: it asserts `inferRecipeFromTranscript`
  and `matchPipelineKeywords` still throw "not implemented", but those were
  shipped (§11.3 / §11.10). The tests are outdated, not the code — update or
  delete them.
