import { describe, it, expect } from 'vitest';
import { extractRecipeJsonLd } from '@/lib/parsing/jsonld';

function page(jsonld: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(
    jsonld,
  )}</script></head><body></body></html>`;
}

const BASE = {
  '@type': 'Recipe',
  name: 'Test Soup',
  recipeIngredient: ['1 onion, diced', '2 cups stock, low-sodium'],
  recipeInstructions: ['Chop the onion.', 'Simmer in stock.'],
};

describe('extractRecipeJsonLd', () => {
  it('extracts a basic recipe', () => {
    const r = extractRecipeJsonLd(page(BASE));
    expect(r).not.toBeNull();
    expect(r!.title).toBe('Test Soup');
    expect(r!.ingredients).toHaveLength(2);
    expect(r!.steps).toHaveLength(2);
  });

  it('keeps each ingredient array element verbatim (does NOT comma-split)', () => {
    const r = extractRecipeJsonLd(page(BASE));
    // "2 cups stock, low-sodium" must remain one ingredient, not two.
    expect(r!.ingredients).toContain('2 cups stock, low-sodium');
  });

  it('walks @graph wrappers', () => {
    const html = page({ '@context': 'x', '@graph': [{ '@type': 'WebPage' }, BASE] });
    const r = extractRecipeJsonLd(html);
    expect(r).not.toBeNull();
    expect(r!.title).toBe('Test Soup');
  });

  it('flattens HowToStep instruction objects', () => {
    const r = extractRecipeJsonLd(
      page({
        ...BASE,
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Step one body.' },
          { '@type': 'HowToStep', text: 'Step two body.' },
        ],
      }),
    );
    expect(r!.steps).toEqual(['Step one body.', 'Step two body.']);
  });

  it('flattens HowToSection (nested itemListElement)', () => {
    const r = extractRecipeJsonLd(
      page({
        ...BASE,
        recipeInstructions: [
          {
            '@type': 'HowToSection',
            itemListElement: [
              { '@type': 'HowToStep', text: 'Nested A.' },
              { '@type': 'HowToStep', text: 'Nested B.' },
            ],
          },
        ],
      }),
    );
    expect(r!.steps).toEqual(['Nested A.', 'Nested B.']);
  });

  it('splits a multi-line string instruction into steps', () => {
    const r = extractRecipeJsonLd(
      page({ ...BASE, recipeInstructions: 'Do A.\nDo B.\nDo C.' }),
    );
    expect(r!.steps).toEqual(['Do A.', 'Do B.', 'Do C.']);
  });

  it('parses ISO-8601 totalTime to minutes', () => {
    const r = extractRecipeJsonLd(page({ ...BASE, totalTime: 'PT1H30M' }));
    expect(r!.totalMinutes).toBe(90);
  });

  it('sums cook + prep when no totalTime', () => {
    const r = extractRecipeJsonLd(
      page({ ...BASE, cookTime: 'PT45M', prepTime: 'PT15M' }),
    );
    expect(r!.totalMinutes).toBe(60);
  });

  it('extracts nutrition fields', () => {
    const r = extractRecipeJsonLd(
      page({
        ...BASE,
        nutrition: {
          '@type': 'NutritionInformation',
          calories: '320 kcal',
          proteinContent: '12 g',
          carbohydrateContent: '40 g',
          fatContent: '8 g',
        },
      }),
    );
    expect(r!.nutrition).toMatchObject({
      per: 'serving',
      source: 'extracted',
      calories: 320,
      protein: 12,
      carbs: 40,
      fat: 8,
    });
  });

  it('resolves a recipeYield number', () => {
    const r = extractRecipeJsonLd(page({ ...BASE, recipeYield: '6 servings' }));
    expect(r!.serves).toBe(6);
  });

  it('resolves publisher from an Organization object', () => {
    const r = extractRecipeJsonLd(
      page({ ...BASE, publisher: { '@type': 'Organization', name: 'NYT Cooking' } }),
    );
    expect(r!.publisher).toBe('NYT Cooking');
  });

  it('resolves image from an array of ImageObjects', () => {
    const r = extractRecipeJsonLd(
      page({
        ...BASE,
        image: [{ '@type': 'ImageObject', url: 'https://x/a.jpg' }],
      }),
    );
    expect(r!.imageUrl).toBe('https://x/a.jpg');
  });

  it('returns null when there is no Recipe node', () => {
    expect(extractRecipeJsonLd(page({ '@type': 'WebPage' }))).toBeNull();
  });

  it('returns null when ingredients or steps are empty', () => {
    expect(
      extractRecipeJsonLd(page({ ...BASE, recipeIngredient: [] })),
    ).toBeNull();
  });

  it('survives a malformed JSON-LD block alongside a good one', () => {
    const html =
      `<script type="application/ld+json">{ this is broken </script>` +
      page(BASE);
    const r = extractRecipeJsonLd(html);
    expect(r).not.toBeNull();
    expect(r!.title).toBe('Test Soup');
  });

  it('decodes HTML entities in title/ingredients', () => {
    const r = extractRecipeJsonLd(
      page({ ...BASE, name: 'Mac &amp; Cheese' }),
    );
    expect(r!.title).toBe('Mac & Cheese');
  });

  it('caps tags and lowercases them', () => {
    const r = extractRecipeJsonLd(
      page({ ...BASE, keywords: 'Soup, Vegan, Quick' }),
    );
    expect(r!.tags).toEqual(expect.arrayContaining(['soup', 'vegan', 'quick']));
  });
});
