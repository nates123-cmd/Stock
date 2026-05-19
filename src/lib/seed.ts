import type { PantryItem, PipelineIdea, Recipe } from '@/types';

/**
 * Sample recipes so the library + detail are immediately rich on first run
 * (and on web, where there's no SQLite — spec §12). Shapes follow the §4 data
 * model exactly: real modifications, parsed timers/temps, tags, cook counts.
 *
 * Dates are concrete so "upped from … (Apr)" annotations render correctly.
 */
const d = (iso: string) => new Date(iso);

export function seedRecipes(): Recipe[] {
  return [
    {
      id: 'seed_bread',
      title: 'No-Knead Country Loaf',
      source: {
        type: 'nyt',
        url: 'https://cooking.nytimes.com/recipes/11376-no-knead-bread',
        author: 'Mark Bittman',
      },
      status: 'active',
      yield: { serves: 8, totalMinutes: 1110 },
      tags: ['baking', 'project', 'bread'],
      cookCount: 4,
      myNotes:
        'Bump hydration on humid days. The 10g salt change is permanent — 8g read flat.',
      createdAt: d('2026-01-12T15:00:00Z'),
      modifiedAt: d('2026-04-09T18:30:00Z'),
      ingredients: [
        {
          id: 'i_flour',
          amount: 430,
          unit: 'g',
          canonicalName: 'bread flour',
          originalText: '3⅓ cups bread flour',
          inlineNote: 'King Arthur',
          modificationHistory: [],
        },
        {
          id: 'i_salt',
          amount: 10,
          unit: 'g',
          canonicalName: 'fine sea salt',
          originalText: '1¼ tsp salt',
          modificationHistory: [
            {
              id: 'm_salt1',
              cookId: 'c_bread3',
              date: d('2026-04-09T18:30:00Z'),
              type: 'amount',
              before: 8,
              after: 10,
              reason: 'underseasoned at 8g across 3 bakes',
            },
          ],
        },
        {
          id: 'i_yeast',
          amount: 1,
          unit: 'g',
          canonicalName: 'instant yeast',
          originalText: '¼ tsp instant yeast',
          modificationHistory: [],
        },
        {
          id: 'i_water',
          amount: 345,
          unit: 'g',
          canonicalName: 'water, room temp',
          originalText: '1½ cups water',
          modificationHistory: [],
        },
      ],
      steps: [
        {
          id: 's1',
          ordinal: 1,
          title: 'Mix and rest',
          body: 'Whisk flour, salt and yeast. Add water; stir to a shaggy dough. Cover and rest 12–18 hours at room temperature until surface is dotted with bubbles.',
          parsedTimers: [{ durationSeconds: 54000, label: 'bulk ferment' }],
          parsedAmounts: [],
          modificationHistory: [],
        },
        {
          id: 's2',
          ordinal: 2,
          title: 'Shape and proof',
          body: 'Fold dough over twice on a floured surface, shape into a ball, and proof seam-side down in a floured towel for 2 hours.',
          parsedTimers: [{ durationSeconds: 7200, label: 'final proof' }],
          parsedAmounts: [],
          modificationHistory: [],
        },
        {
          id: 's3',
          ordinal: 3,
          title: 'Bake in a hot Dutch oven',
          body: 'Heat a covered Dutch oven at 450°F for 30 minutes. Drop the dough in, bake covered 30 minutes, then uncovered until deep brown, about 15 minutes more.',
          parsedTimers: [
            { durationSeconds: 1800, label: 'covered' },
            { durationSeconds: 900, label: 'uncovered' },
          ],
          parsedTemperature: 450,
          parsedAmounts: [],
          modificationHistory: [],
        },
      ],
    },
    {
      id: 'seed_chicken',
      title: 'Sheet-Pan Chicken & Lemon',
      source: { type: 'mine' },
      status: 'active',
      yield: { serves: 4, totalMinutes: 45 },
      tags: ['weeknight', 'sheet-pan'],
      cookCount: 9,
      myNotes: 'The go-to. Swap the herb depending on what is wilting.',
      createdAt: d('2025-11-02T01:00:00Z'),
      modifiedAt: d('2026-02-18T02:10:00Z'),
      ingredients: [
        {
          id: 'c_thighs',
          amount: 8,
          unit: 'pc',
          canonicalName: 'chicken thighs, bone-in',
          originalText: '8 bone-in chicken thighs',
          modificationHistory: [],
        },
        {
          id: 'c_lemon',
          amount: 2,
          unit: 'pc',
          canonicalName: 'lemons',
          originalText: '2 lemons, sliced',
          modificationHistory: [],
        },
        {
          id: 'c_potato',
          amount: 700,
          unit: 'g',
          canonicalName: 'baby potatoes',
          originalText: '1½ lb baby potatoes, halved',
          modificationHistory: [],
        },
        {
          id: 'c_oil',
          amount: 30,
          unit: 'ml',
          canonicalName: 'olive oil, EVOO',
          originalText: '2 tbsp olive oil',
          inlineNote: 'good stuff, not blend',
          modificationHistory: [],
        },
      ],
      steps: [
        {
          id: 'cs1',
          ordinal: 1,
          title: 'Toss and arrange',
          body: 'Heat oven to 425°F. Toss potatoes and lemon with half the oil on a sheet pan. Nestle in oiled, salted thighs skin-side up.',
          parsedTimers: [],
          parsedTemperature: 425,
          parsedAmounts: [],
          modificationHistory: [],
        },
        {
          id: 'cs2',
          ordinal: 2,
          title: 'Roast until crisp',
          body: 'Roast 35–40 minutes until skin is crisp and potatoes are tender. Rest 5 minutes before serving.',
          parsedTimers: [{ durationSeconds: 2100, label: 'roast' }],
          parsedAmounts: [],
          modificationHistory: [],
        },
      ],
    },
    {
      id: 'seed_sushi',
      title: 'Sushi Rice',
      source: { type: 'book', bookRef: 'Tsuji, Japanese Cooking p.281' },
      status: 'active',
      yield: { serves: 4, totalMinutes: 50 },
      tags: ['project', 'sushi'],
      cookCount: 2,
      createdAt: d('2026-03-01T20:00:00Z'),
      modifiedAt: d('2026-03-20T22:00:00Z'),
      ingredients: [
        {
          id: 'r_rice',
          amount: 400,
          unit: 'g',
          canonicalName: 'short-grain rice',
          originalText: '2 cups sushi rice',
          modificationHistory: [],
        },
        {
          id: 'r_vinegar',
          amount: 60,
          unit: 'ml',
          canonicalName: 'rice vinegar',
          originalText: '¼ cup rice vinegar',
          modificationHistory: [
            {
              id: 'm_vin1',
              date: d('2026-03-20T22:00:00Z'),
              type: 'amount',
              before: 50,
              after: 60,
              reason: 'wanted it sharper',
            },
          ],
        },
        {
          id: 'r_sugar',
          amount: 25,
          unit: 'g',
          canonicalName: 'sugar',
          originalText: '2 tbsp sugar',
          modificationHistory: [],
        },
      ],
      steps: [
        {
          id: 'rs1',
          ordinal: 1,
          title: 'Rinse and cook',
          body: 'Rinse rice until water runs clear. Cook with equal water; rest off heat 10 minutes covered.',
          parsedTimers: [{ durationSeconds: 600, label: 'steam rest' }],
          parsedAmounts: [],
          modificationHistory: [],
        },
        {
          id: 'rs2',
          ordinal: 2,
          title: 'Cut in the seasoning',
          body: 'Warm vinegar, sugar and a pinch of salt until dissolved. Fold through hot rice with a slicing motion while fanning to cool.',
          parsedTimers: [],
          parsedAmounts: [],
          modificationHistory: [],
        },
      ],
    },
  ];
}

/**
 * Sample pantry so the §10 list, the "have it" indicator, and cycle estimates
 * are immediately real on first run / web preview. Canonical names line up
 * with seedRecipes() so coverage lights up: Sheet-Pan Chicken and Sushi Rice
 * read as fully "have it"; the bread only misses water.
 *
 * Staples carry multi-purchase history so the cycle-learning math (spec §10)
 * has something to chew on. Acquisition dates are relative to mid-May 2026
 * (last Instacart "May 11").
 */
export function seedPantry(): PantryItem[] {
  return [
    // ---- Always have (staples) ----
    {
      id: 'p_oil',
      canonicalName: 'olive oil, EVOO',
      amount: 750,
      unit: 'ml',
      location: 'pantry',
      isStaple: true,
      acquiredAt: d('2026-05-11T17:00:00Z'),
      defaultFreshnessDays: 365,
      purchaseHistory: [
        d('2026-02-01T17:00:00Z'),
        d('2026-03-23T17:00:00Z'),
        d('2026-05-11T17:00:00Z'),
      ],
      originalInstacartText: 'California Olive Ranch EVOO, 750 ml',
    },
    {
      id: 'p_flour',
      canonicalName: 'bread flour',
      amount: 2,
      unit: 'kg',
      location: 'pantry',
      isStaple: true,
      acquiredAt: d('2026-05-11T17:00:00Z'),
      defaultFreshnessDays: 365,
      purchaseHistory: [
        d('2026-01-10T17:00:00Z'),
        d('2026-02-20T17:00:00Z'),
        d('2026-04-15T17:00:00Z'),
        d('2026-05-11T17:00:00Z'),
      ],
      originalInstacartText: 'King Arthur Bread Flour, 2 kg',
    },
    {
      id: 'p_vinegar',
      canonicalName: 'rice vinegar',
      amount: 500,
      unit: 'ml',
      location: 'pantry',
      isStaple: true,
      acquiredAt: d('2026-05-11T17:00:00Z'),
      defaultFreshnessDays: 365,
      purchaseHistory: [
        d('2026-01-12T17:00:00Z'),
        d('2026-03-13T17:00:00Z'),
        d('2026-05-11T17:00:00Z'),
      ],
    },
    {
      id: 'p_salt',
      canonicalName: 'fine sea salt',
      location: 'pantry',
      isStaple: true,
      acquiredAt: d('2026-03-20T17:00:00Z'),
      defaultFreshnessDays: 365,
      purchaseHistory: [d('2025-12-02T17:00:00Z'), d('2026-03-20T17:00:00Z')],
    },
    {
      id: 'p_sugar',
      canonicalName: 'sugar',
      amount: 1,
      unit: 'kg',
      location: 'pantry',
      isStaple: true,
      acquiredAt: d('2026-02-10T17:00:00Z'),
      defaultFreshnessDays: 365,
      purchaseHistory: [d('2026-02-10T17:00:00Z')],
    },
    {
      id: 'p_yeast',
      canonicalName: 'instant yeast',
      location: 'fridge',
      isStaple: true,
      acquiredAt: d('2026-03-01T17:00:00Z'),
      defaultFreshnessDays: 365,
      purchaseHistory: [d('2025-11-15T17:00:00Z'), d('2026-03-01T17:00:00Z')],
    },

    // ---- Recently added (last Instacart, May 11) ----
    {
      id: 'p_lemons',
      canonicalName: 'lemons',
      amount: 4,
      unit: 'pc',
      location: 'fridge',
      isStaple: false,
      acquiredAt: d('2026-05-11T17:00:00Z'),
      defaultFreshnessDays: 7,
      expiresAt: d('2026-05-18T17:00:00Z'),
      purchaseHistory: [d('2026-05-11T17:00:00Z')],
      originalInstacartText: "Sunkist Lemons, 2 lb bag",
    },
    {
      id: 'p_rasp',
      canonicalName: 'raspberries',
      amount: 12,
      unit: 'oz',
      location: 'fridge',
      isStaple: false,
      acquiredAt: d('2026-05-12T17:00:00Z'),
      defaultFreshnessDays: 7,
      expiresAt: d('2026-05-19T17:00:00Z'),
      purchaseHistory: [d('2026-05-12T17:00:00Z')],
      originalInstacartText: "Driscoll's Raspberries, 6 oz × 2",
    },
    {
      id: 'p_milk',
      canonicalName: 'milk, whole',
      amount: 1,
      unit: 'gal',
      location: 'fridge',
      isStaple: false,
      acquiredAt: d('2026-05-11T17:00:00Z'),
      defaultFreshnessDays: 14,
      expiresAt: d('2026-05-25T17:00:00Z'),
      purchaseHistory: [d('2026-05-11T17:00:00Z')],
      originalInstacartText: 'Organic Valley Whole Milk, 1 gal',
    },
    {
      id: 'p_potato',
      canonicalName: 'baby potatoes',
      amount: 1.5,
      unit: 'lb',
      location: 'pantry',
      isStaple: false,
      acquiredAt: d('2026-05-15T17:00:00Z'),
      defaultFreshnessDays: 7,
      expiresAt: d('2026-05-22T17:00:00Z'),
      purchaseHistory: [d('2026-05-15T17:00:00Z')],
    },
    {
      id: 'p_rice',
      canonicalName: 'short-grain rice',
      amount: 2,
      unit: 'kg',
      location: 'pantry',
      isStaple: false,
      acquiredAt: d('2026-05-11T17:00:00Z'),
      defaultFreshnessDays: 365,
      purchaseHistory: [d('2026-05-11T17:00:00Z')],
    },

    // ---- Freezer ----
    {
      id: 'p_chicken',
      canonicalName: 'chicken thighs, bone-in',
      amount: 8,
      unit: 'pc',
      location: 'freezer',
      isStaple: false,
      acquiredAt: d('2026-05-06T17:00:00Z'),
      defaultFreshnessDays: 4,
      purchaseHistory: [d('2026-05-06T17:00:00Z')],
    },
  ];
}

/**
 * Sample Pipeline ideas (spec §8) — half-formed things, deliberately separate
 * from cooked recipes. Spread across statuses so the §8 tabs (Active /
 * Captured / Researching / Ready / Archive) all have content, including one
 * already promoted into the seeded recipe library for the Archive tab.
 */
export function seedPipeline(): PipelineIdea[] {
  return [
    {
      id: 'idea_pho',
      title: 'Pho from scratch, someday',
      note: 'Proper bone broth — char the onion + ginger, toast the spices. A weekend, not a weeknight.',
      status: 'captured',
      references: [],
      createdAt: d('2026-04-20T19:00:00Z'),
    },
    {
      id: 'idea_confit',
      title: 'Confit garlic oil',
      note: 'Slow-poach peeled cloves in olive oil. Keeps the oil for dressings, the cloves for everything.',
      status: 'captured',
      references: [],
      createdAt: d('2026-05-15T19:00:00Z'),
    },
    {
      id: 'idea_starter',
      title: 'Revive the sourdough starter',
      note: 'It has been in the fridge since February. Two days of 1:1:1 feeds before it is bake-ready.',
      status: 'researching',
      references: [
        { url: 'https://www.kingarthurbaking.com/recipes/sourdough-starter-recipe', label: 'King Arthur — starter' },
      ],
      createdAt: d('2026-05-02T19:00:00Z'),
    },
    {
      id: 'idea_miso_yolk',
      title: 'Miso-cured egg yolks',
      note: 'Bury yolks in miso + a little sugar for ~4 days. Grate over rice or pasta like bottarga.',
      status: 'ready',
      references: [
        { url: 'https://www.seriouseats.com/miso-cured-egg-yolks', label: 'Serious Eats' },
        { url: 'https://www.youtube.com/watch?v=example', label: 'technique video' },
      ],
      bestGuessIngredients: [
        {
          id: 'bg_yolk',
          amount: 6,
          unit: 'pc',
          canonicalName: 'egg yolks',
          modificationHistory: [],
        },
        {
          id: 'bg_miso',
          amount: 500,
          unit: 'g',
          canonicalName: 'white miso',
          modificationHistory: [],
        },
        {
          id: 'bg_sugar',
          amount: 2,
          unit: 'tbsp',
          canonicalName: 'sugar',
          modificationHistory: [],
        },
      ],
      createdAt: d('2026-05-10T19:00:00Z'),
    },
    {
      id: 'idea_smash',
      title: 'Weeknight smash burgers',
      note: 'Promoted after the first cook — thin patties, screaming-hot pan, no fuss.',
      status: 'promoted',
      references: [],
      promotedRecipeId: 'seed_chicken',
      createdAt: d('2026-03-08T19:00:00Z'),
    },
  ];
}
