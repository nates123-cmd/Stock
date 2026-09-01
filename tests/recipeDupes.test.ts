import { describe, expect, it } from 'vitest';
import type { Recipe } from '@/types';
import {
  canonicalUrl,
  findDuplicate,
  findDuplicateCandidates,
  idSlug,
  richer,
  titleKey,
} from '@/lib/recipeDupes';

const rec = (p: Partial<Recipe> & { id: string; title: string }): Recipe =>
  ({
    status: 'active',
    tags: [],
    cookCount: 0,
    ingredients: [],
    steps: [],
    createdAt: new Date('2026-01-01'),
    modifiedAt: new Date('2026-01-01'),
    ...p,
  }) as Recipe;

describe('canonicalUrl', () => {
  it('ignores an origin-only url', () => {
    // 25 recipes share this exact string; matching on it would collapse them.
    expect(canonicalUrl(rec({ id: 'a', title: 'x', source: { type: 'nyt', url: 'https://cooking.nytimes.com' } }))).toBeNull();
    expect(canonicalUrl(rec({ id: 'a', title: 'x', source: { type: 'web', url: 'https://brianlagerstrom.com/' } }))).toBeNull();
  });

  it('keeps a deep url, normalised', () => {
    expect(
      canonicalUrl(rec({ id: 'a', title: 'x', source: { type: 'nyt', url: 'https://www.cooking.nytimes.com/recipes/1024075-dumpling-tomato-salad?utm=1' } })),
    ).toBe('cooking.nytimes.com/recipes/1024075-dumpling-tomato-salad');
  });

  it('is null when there is no url at all', () => {
    expect(canonicalUrl(rec({ id: 'a', title: 'x' }))).toBeNull();
  });
});

describe('titleKey', () => {
  it('bridges the compressed and full title of the same recipe', () => {
    expect(titleKey('Sheet-Pan Feta Chickpeas Tomatoes')).toBe(
      titleKey('Sheet-Pan Feta With Chickpeas and Tomatoes'),
    );
    expect(titleKey('Creamy Spicy Tomato Beans Greens')).toBe(
      titleKey('Creamy, Spicy Tomato Beans and Greens'),
    );
    expect(titleKey('Roasted Cauliflower Garlic Soup')).toBe(
      titleKey('Roasted Cauliflower and Garlic Soup'),
    );
  });

  it('keeps genuinely different recipes apart', () => {
    expect(titleKey('Pasta Salad')).not.toBe(titleKey('Tapenade Pasta Salad'));
    expect(titleKey('Steak Salad')).not.toBe(titleKey('Blackened Tri-Tip Steak Salad'));
  });
});

describe('idSlug', () => {
  it('strips both import-batch prefixes to a common slug', () => {
    expect(idSlug('rec_sheet-pan-feta-with-chickpeas-and-tomatoes')).toBe(
      idSlug('rec_nyt_1023371-sheet-pan-feta-with-chickpeas-and-tomatoes'),
    );
  });
});

describe('findDuplicate', () => {
  const library = [
    rec({
      id: 'rec_sheet-pan-feta-with-chickpeas-and-tomatoes',
      title: 'Sheet-Pan Feta Chickpeas Tomatoes',
      source: { type: 'nyt', url: 'https://cooking.nytimes.com' },
    }),
    rec({
      id: 'rec_nyt_1024075-dumpling-tomato-salad-with-chile-crisp-vinaigrette',
      title: 'Dumpling Tomato Salad With Chile Crisp Vinaigrette',
      source: { type: 'nyt', url: 'https://cooking.nytimes.com/recipes/1024075-dumpling-tomato-salad-with-chile-crisp-vinaigrette' },
    }),
    rec({ id: 'rec_pasta-salad', title: 'Pasta Salad' }),
  ];

  it('catches the May-vs-Aug title collision', () => {
    const hit = findDuplicate(
      rec({
        id: 'rec_nyt_1023371-sheet-pan-feta-with-chickpeas-and-tomatoes',
        title: 'Sheet-Pan Feta With Chickpeas and Tomatoes',
        source: { type: 'nyt', url: 'https://cooking.nytimes.com/recipes/1023371-sheet-pan-feta' },
      }),
      library,
    );
    expect(hit?.existing.id).toBe('rec_sheet-pan-feta-with-chickpeas-and-tomatoes');
  });

  it('catches a same-deep-url pair whose titles differ', () => {
    const hit = findDuplicate(
      rec({
        id: 'rec_new',
        title: 'Dumpling Tomato Salad With Chile Crisp',
        source: { type: 'nyt', url: 'https://cooking.nytimes.com/recipes/1024075-dumpling-tomato-salad-with-chile-crisp-vinaigrette' },
      }),
      library,
    );
    expect(hit?.reason).toBe('url');
  });

  it('does NOT match two recipes that merely share an origin', () => {
    const hit = findDuplicate(
      rec({
        id: 'rec_kung-pao-tofu',
        title: 'Kung Pao Tofu',
        source: { type: 'nyt', url: 'https://cooking.nytimes.com' },
      }),
      library,
    );
    expect(hit).toBeNull();
  });

  it('does NOT match a narrower variant of a general recipe', () => {
    expect(
      findDuplicate(rec({ id: 'rec_tapenade-pasta-salad', title: 'Tapenade Pasta Salad' }), library),
    ).toBeNull();
  });

  it('never matches a recipe against itself, so edits still save', () => {
    expect(findDuplicate(library[0]!, library)).toBeNull();
  });
});

describe('findDuplicateCandidates', () => {
  it('ranks certain matches above merely similar ones', () => {
    const lib = [
      rec({ id: 'a', title: 'Pasta Salad' }),
      rec({ id: 'b', title: 'Tapenade Pasta Salad' }),
      rec({ id: 'c', title: 'Roasted Cauliflower Garlic Soup' }),
      rec({ id: 'd', title: 'Roasted Cauliflower and Garlic Soup' }),
    ];
    const pairs = findDuplicateCandidates(lib);
    expect(pairs[0]!.certain).toBe(true);
    expect(pairs[0]!.reason).toBe('title');
    expect(pairs.some((p) => p.reason === 'similar')).toBe(true);
  });
});

describe('richer', () => {
  it('prefers the deep-url, photo-carrying copy over the bare one', () => {
    const thin = rec({ id: 'thin', title: 'X', source: { type: 'nyt', url: 'https://cooking.nytimes.com' } });
    const full = rec({
      id: 'full',
      title: 'X',
      source: { type: 'nyt', url: 'https://cooking.nytimes.com/recipes/1-x' },
      imageUrl: 'data:image/png;base64,zz',
    });
    expect(richer(thin, full).id).toBe('full');
  });

  it('keeps the copy Nate has actually cooked and annotated', () => {
    const loved = rec({ id: 'loved', title: 'X', cookCount: 4, myNotes: 'more salt' });
    const fresh = rec({
      id: 'fresh',
      title: 'X',
      source: { type: 'nyt', url: 'https://cooking.nytimes.com/recipes/1-x' },
      imageUrl: 'data:image/png;base64,zz',
    });
    expect(richer(loved, fresh).id).toBe('loved');
  });
});
