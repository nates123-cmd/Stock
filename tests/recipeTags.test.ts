import { describe, it, expect } from 'vitest';
import {
  AUTO_TAGS,
  applyTagEdit,
  deriveTags,
  isAutoTag,
  matchesQuery,
  reconcileTags,
  type TaggableRecipe,
  type TagMeta,
} from '../src/lib/recipeTags';

const r = (
  p: Omit<Partial<TaggableRecipe>, 'ingredients' | 'steps'> & {
    ings?: string[];
    steps?: string[];
  },
): TaggableRecipe => ({
  title: p.title ?? 'Test dish',
  ingredients: (p.ings ?? []).map((canonicalName) => ({ canonicalName })),
  steps: (p.steps ?? []).map((body) => ({ body })),
  yield: p.yield,
  nutrition: p.nutrition,
});

/* ------------------------------------------------------------------ *
 * Diet
 * ------------------------------------------------------------------ */

describe('dietary tags', () => {
  it('tags a plants-only dish vegetarian AND vegan', () => {
    const t = deriveTags(
      r({ ings: ['chickpeas', 'olive oil', 'cumin', 'lemon'], steps: ['Simmer.'] }),
    );
    expect(t).toContain('vegetarian');
    expect(t).toContain('vegan');
  });

  it('tags dairy as vegetarian but not vegan', () => {
    const t = deriveTags(
      r({ ings: ['penne', 'parmesan', 'butter', 'black pepper'], steps: ['Boil.'] }),
    );
    expect(t).toContain('vegetarian');
    expect(t).not.toContain('vegan');
  });

  it('does not tag meat or seafood as vegetarian', () => {
    for (const meat of ['chicken thighs', 'pancetta', 'anchovies', 'fish sauce']) {
      const t = deriveTags(r({ ings: ['olive oil', meat], steps: ['Cook.'] }));
      expect(t, meat).not.toContain('vegetarian');
    }
  });

  it('is not fooled by ingredients that merely contain an animal word', () => {
    // Every one of these breaks a naive substring check.
    const t = deriveTags(
      r({
        ings: [
          'eggplant',
          'peanut butter',
          'coconut milk',
          'chickpeas',
          'butternut squash',
          'beefsteak tomato',
          'nutritional yeast',
          'cream of tartar',
        ],
        steps: ['Roast.'],
      }),
    );
    expect(t).toContain('vegetarian');
    expect(t).toContain('vegan');
  });

  it('reads plant-based substitutes as plants', () => {
    const t = deriveTags(
      r({ ings: ['beyond beef', 'vegan butter', 'oat milk'], steps: ['Fry.'] }),
    );
    expect(t).toContain('vegan');
  });

  it('does not treat vegetable broth as beef broth', () => {
    const t = deriveTags(r({ ings: ['vegetable broth', 'barley'], steps: ['Simmer.'] }));
    expect(t).toContain('vegetarian');
  });

  it('claims no diet at all when there are no ingredients to judge', () => {
    const t = deriveTags(r({ ings: [], steps: ['Do something.'] }));
    expect(t).not.toContain('vegetarian');
    expect(t).not.toContain('vegan');
  });
});

/* ------------------------------------------------------------------ *
 * Effort and method
 * ------------------------------------------------------------------ */

describe('effort tags', () => {
  it('tags a 20-minute recipe quick and weeknight', () => {
    const t = deriveTags(
      r({ ings: ['pasta'], steps: ['Boil.', 'Toss.'], yield: { totalMinutes: 20 } }),
    );
    expect(t).toContain('quick');
    expect(t).toContain('weeknight');
  });

  it('tags a 45-minute recipe weeknight but not quick', () => {
    const t = deriveTags(
      r({ ings: ['rice'], steps: ['Cook.'], yield: { totalMinutes: 45 } }),
    );
    expect(t).toContain('weeknight');
    expect(t).not.toContain('quick');
  });

  it('tags a long cook a project', () => {
    const t = deriveTags(
      r({ ings: ['beef shin'], steps: ['Braise.'], yield: { totalMinutes: 240 } }),
    );
    expect(t).toContain('project');
    expect(t).not.toContain('weeknight');
  });

  it('tags a very long method a project even without a time', () => {
    const t = deriveTags(r({ ings: ['flour'], steps: Array(20).fill('Step.') }));
    expect(t).toContain('project');
  });

  it('claims no effort tag when the recipe has no time on it', () => {
    const t = deriveTags(r({ ings: ['rice'], steps: ['Cook.'] }));
    expect(t).not.toContain('quick');
    expect(t).not.toContain('weeknight');
  });

  it('ignores a zero cook time rather than calling it quick', () => {
    const t = deriveTags(r({ ings: ['rice'], steps: ['Cook.'], yield: { totalMinutes: 0 } }));
    expect(t).not.toContain('quick');
  });
});

describe('method tags', () => {
  it('tags baking from the oven plus a baking ingredient', () => {
    const t = deriveTags(
      r({ ings: ['flour', 'sugar', 'butter'], steps: ['Bake at 350F for 30 minutes.'] }),
    );
    expect(t).toContain('baking');
  });

  it('does not tag baking for a roasted vegetable', () => {
    const t = deriveTags(
      r({ ings: ['carrots', 'olive oil'], steps: ['Roast in the oven.'] }),
    );
    expect(t).not.toContain('baking');
  });

  it('tags one-pot from the method', () => {
    const t = deriveTags(
      r({ ings: ['rice', 'stock'], steps: ['In one pot, combine everything.'] }),
    );
    expect(t).toContain('one-pot');
  });

  it('tags no-cook when nothing is heated', () => {
    const t = deriveTags(
      r({ ings: ['tomatoes', 'basil'], steps: ['Slice.', 'Dress and serve.'] }),
    );
    expect(t).toContain('no-cook');
  });

  it('does not tag no-cook when a step preheats an oven', () => {
    const t = deriveTags(r({ ings: ['bread'], steps: ['Preheat the oven.', 'Slice.'] }));
    expect(t).not.toContain('no-cook');
  });

  it('tags spicy from a chilli ingredient', () => {
    const t = deriveTags(r({ ings: ['gochujang', 'rice'], steps: ['Stir.'] }));
    expect(t).toContain('spicy');
  });
});

describe('healthy', () => {
  it('trusts nutrition when it is there', () => {
    const light = deriveTags(
      r({ ings: ['salmon', 'spinach'], steps: ['Cook.'], nutrition: { calories: 420, fat: 18 } }),
    );
    expect(light).toContain('healthy');
    const heavy = deriveTags(
      r({ ings: ['pork belly'], steps: ['Cook.'], nutrition: { calories: 1100, fat: 70 } }),
    );
    expect(heavy).not.toContain('healthy');
  });

  it('falls back to a vegetable-forward heuristic', () => {
    const t = deriveTags(
      r({
        ings: ['spinach', 'chickpeas', 'tomato', 'garlic', 'lemon'],
        steps: ['Simmer.'],
      }),
    );
    expect(t).toContain('healthy');
  });

  it('refuses to call an indulgent recipe healthy', () => {
    const t = deriveTags(
      r({
        ings: ['spinach', 'kale', 'broccoli', 'carrot', 'heavy cream'],
        steps: ['Simmer.'],
      }),
    );
    expect(t).not.toContain('healthy');
  });
});

describe('the vocabulary is closed', () => {
  it('only ever emits tags from AUTO_TAGS', () => {
    const t = deriveTags(
      r({
        title: 'Everything',
        ings: ['spinach', 'chickpeas', 'tomato', 'garlic', 'gochujang'],
        steps: ['In one pot, simmer.'],
        yield: { totalMinutes: 25 },
      }),
    );
    for (const tag of t) expect(isAutoTag(tag)).toBe(true);
  });

  it('emits in a stable vocabulary order', () => {
    const t = deriveTags(
      r({ ings: ['tomatoes', 'basil'], steps: ['Slice.'], yield: { totalMinutes: 10 } }),
    );
    const order = t.map((x) => AUTO_TAGS.indexOf(x));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('is deterministic', () => {
    const recipe = r({
      ings: ['spinach', 'chickpeas', 'tomato', 'garlic'],
      steps: ['Simmer.'],
      yield: { totalMinutes: 25 },
    });
    expect(deriveTags(recipe)).toEqual(deriveTags(recipe));
  });
});

/* ------------------------------------------------------------------ *
 * Edits win
 * ------------------------------------------------------------------ */

describe('auto tags never fight your edits', () => {
  it('adds derived tags on a first run without touching what is there', () => {
    const res = reconcileTags(['nate favourite'], ['quick', 'vegan'], undefined);
    expect(res.tags).toEqual(['nate favourite', 'quick', 'vegan']);
    expect(res.tagMeta.auto).toEqual(['quick', 'vegan']);
  });

  it('never re-adds an auto tag you deleted, however many times it runs', () => {
    let tags = ['quick', 'vegan'];
    let meta: TagMeta = { auto: ['quick', 'vegan'] };

    // You delete "vegan".
    const next = ['quick'];
    meta = applyTagEdit(tags, next, meta);
    tags = next;
    expect(meta.removed).toContain('vegan');

    for (let i = 0; i < 5; i++) {
      const res = reconcileTags(tags, ['quick', 'vegan'], meta);
      tags = res.tags;
      meta = res.tagMeta;
      expect(tags).not.toContain('vegan');
    }
  });

  it('keeps a tag you typed, even when the tagger would never emit it', () => {
    let tags = ['quick'];
    let meta: TagMeta = { auto: ['quick'] };
    meta = applyTagEdit(tags, ['quick', 'amanda loves this'], meta);
    tags = ['quick', 'amanda loves this'];
    const res = reconcileTags(tags, ['quick'], meta);
    expect(res.tags).toContain('amanda loves this');
    expect(res.tagMeta.auto).toEqual(['quick']);
  });

  it('keeps a tag you typed that the tagger ALSO derives', () => {
    // You added "healthy" by hand. Even if the recipe later stops earning it,
    // it must stay — you put it there.
    let meta = applyTagEdit([], ['healthy'], undefined);
    expect(meta.auto).toEqual([]);
    const res = reconcileTags(['healthy'], [], meta);
    expect(res.tags).toEqual(['healthy']);
  });

  it('drops an auto tag the recipe no longer earns', () => {
    const res = reconcileTags(['quick', 'project'], ['quick'], {
      auto: ['quick', 'project'],
    });
    expect(res.tags).toEqual(['quick']);
  });

  it('re-typing a deleted tag withdraws the refusal', () => {
    let meta: TagMeta = { auto: [], removed: ['vegan'] };
    meta = applyTagEdit([], ['vegan'], meta);
    expect(meta.removed).not.toContain('vegan');
    // And now it survives a re-run as YOUR tag.
    const res = reconcileTags(['vegan'], ['vegan'], meta);
    expect(res.tags).toEqual(['vegan']);
    expect(res.tagMeta.auto).toEqual([]);
  });

  it('treats a recipe with no provenance as entirely user-owned', () => {
    // Turning auto-tagging on must not take away tags that came from the
    // source or that Nate typed before this existed.
    const res = reconcileTags(['weeknight', 'from bon appetit'], ['quick'], undefined);
    expect(res.tags).toContain('weeknight');
    expect(res.tags).toContain('from bon appetit');
    expect(res.tags).toContain('quick');
  });

  it('is idempotent across repeated runs', () => {
    let tags = ['mine'];
    let meta: TagMeta | undefined;
    const derived = ['quick', 'vegan'];
    for (let i = 0; i < 4; i++) {
      const res = reconcileTags(tags, derived, meta);
      tags = res.tags;
      meta = res.tagMeta;
    }
    expect(tags).toEqual(['mine', 'quick', 'vegan']);
  });

  it('does not let the removed list grow with free-form names', () => {
    const meta = applyTagEdit(['scribbled note'], [], { auto: ['scribbled note'] });
    expect(meta.removed).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

describe('search', () => {
  const dish = {
    title: 'Sheet-pan chicken thighs',
    tags: ['weeknight', 'one-pot'],
    ingredients: [{ canonicalName: 'chicken thighs' }, { canonicalName: 'lemon' }],
  };

  it('matches on title, tag or ingredient', () => {
    expect(matchesQuery(dish, 'sheet')).toBe(true);
    expect(matchesQuery(dish, 'weeknight')).toBe(true);
    expect(matchesQuery(dish, 'lemon')).toBe(true);
  });

  it('requires EVERY term to match — more words narrows', () => {
    expect(matchesQuery(dish, 'weeknight chicken')).toBe(true);
    expect(matchesQuery(dish, 'weeknight salmon')).toBe(false);
  });

  it('restricts a term to tags with a tag: prefix', () => {
    expect(matchesQuery(dish, 'tag:weeknight')).toBe(true);
    // "lemon" is an ingredient, not a tag.
    expect(matchesQuery(dish, 'tag:lemon')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(matchesQuery(dish, '   ')).toBe(true);
  });
});
