import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Claude bridge so we can drive parseRecipeFromText down its
// CLAUDE_AVAILABLE branch (which exercises the private extractJson + mapRaw
// shaping) without any network. Each test sets CLAUDE_AVAILABLE explicitly.
const state: { available: boolean; reply: string; throws: boolean } = {
  available: false,
  reply: '',
  throws: false,
};

vi.mock('@/lib/api/claudeBridge', () => ({
  get CLAUDE_AVAILABLE() {
    return state.available;
  },
  claudeText: vi.fn(async () => {
    if (state.throws) throw new Error('claude boom');
    return state.reply;
  }),
  claudePdf: vi.fn(),
  claudeImage: vi.fn(),
  proxyFetch: vi.fn(),
}));

import {
  detectSource,
  parseRecipeFromText,
  inferRecipeFromTranscript,
  detectTimersAndTemperature,
  generateStepTitle,
  matchPipelineKeywords,
} from '@/lib/parsing/recipe';

beforeEach(() => {
  state.available = false;
  state.reply = '';
  state.throws = false;
});

describe('detectSource', () => {
  it('returns mine for no url', () => {
    expect(detectSource()).toEqual({ type: 'mine' });
  });
  it('classifies NYT cooking', () => {
    const s = detectSource('https://cooking.nytimes.com/recipes/123');
    expect(s.type).toBe('nyt');
    expect(s.name).toBe('NYT Cooking');
  });
  it('classifies YouTube', () => {
    expect(detectSource('https://youtu.be/abc').type).toBe('yt');
  });
  it('strips www and uses known-source name', () => {
    const s = detectSource('https://www.seriouseats.com/x');
    expect(s.name).toBe('Serious Eats');
  });
  it('falls back to hostname for unknown sites', () => {
    const s = detectSource('https://homemade-pizza.com/x');
    expect(s.type).toBe('web');
    expect(s.name).toBe('homemade-pizza.com');
  });
  it('handles a malformed URL gracefully', () => {
    const s = detectSource('not a url');
    expect(s.type).toBe('mine');
    expect(s.url).toBe('not a url');
  });
});

describe('parseRecipeFromText — keyless local fallback', () => {
  it('uses the local parser when Claude is unavailable', async () => {
    const draft = await parseRecipeFromText('2 cups flour\nMix and bake well now.');
    expect(draft.status).toBe('draft');
    expect(draft.fieldConfidence?.ingredients).toBe('guessed');
    expect(draft.ingredients?.length).toBeGreaterThan(0);
  });

  it('falls back to local when Claude throws', async () => {
    state.available = true;
    state.throws = true;
    const draft = await parseRecipeFromText('2 cups flour\nMix and bake well now.');
    // local fallback flags guessed
    expect(draft.fieldConfidence?.ingredients).toBe('guessed');
  });
});

describe('parseRecipeFromText — Claude path (extractJson + mapRaw)', () => {
  beforeEach(() => {
    state.available = true;
  });

  it('parses clean JSON and maps nutrition with estimated source', async () => {
    state.reply = JSON.stringify({
      title: 'Soup',
      serves: 6,
      totalMinutes: 30,
      tags: ['Soup', 'Easy'],
      ingredients: [{ amount: 2, unit: 'cup', canonicalName: 'stock' }],
      steps: [{ title: 'Simmer', body: 'Simmer it.' }],
      nutrition: { calories: 300, protein: 10, carbs: 40, fat: 5 },
    });
    const draft = await parseRecipeFromText('whatever', { type: 'mine' });
    expect(draft.title).toBe('Soup');
    expect(draft.yield?.serves).toBe(6);
    expect(draft.tags).toEqual(['soup', 'easy']); // lowercased
    expect(draft.nutrition?.source).toBe('estimated');
    expect(draft.nutrition?.calories).toBe(300);
    expect(draft.ingredients?.[0]?.id).toMatch(/^ing_/);
    expect(draft.steps?.[0]?.ordinal).toBe(1);
  });

  it('strips a ```json markdown fence', async () => {
    state.reply =
      '```json\n' +
      JSON.stringify({
        title: 'Fenced',
        serves: 2,
        ingredients: [{ amount: 1, unit: null, canonicalName: 'egg' }],
        steps: [{ title: 'Cook', body: 'Cook it.' }],
      }) +
      '\n```';
    const draft = await parseRecipeFromText('x');
    expect(draft.title).toBe('Fenced');
  });

  it('extracts JSON embedded in surrounding prose', async () => {
    state.reply =
      'Here is your recipe: ' +
      JSON.stringify({
        title: 'Prosed',
        serves: 1,
        ingredients: [{ amount: 1, unit: null, canonicalName: 'egg' }],
        steps: [{ title: 'Cook', body: 'Cook.' }],
      }) +
      ' Enjoy!';
    const draft = await parseRecipeFromText('x');
    expect(draft.title).toBe('Prosed');
  });

  it('clamps a non-positive serves to 4', async () => {
    state.reply = JSON.stringify({
      title: 'Z',
      serves: 0,
      ingredients: [{ amount: 1, unit: null, canonicalName: 'egg' }],
      steps: [{ title: 'C', body: 'C.' }],
    });
    const draft = await parseRecipeFromText('x');
    expect(draft.yield?.serves).toBe(4);
  });

  it('omits nutrition when all macros are null', async () => {
    state.reply = JSON.stringify({
      title: 'Z',
      serves: 2,
      ingredients: [{ amount: 1, unit: null, canonicalName: 'egg' }],
      steps: [{ title: 'C', body: 'C.' }],
      nutrition: { calories: null, protein: null, carbs: null, fat: null },
    });
    const draft = await parseRecipeFromText('x');
    expect(draft.nutrition).toBeUndefined();
  });

  it('falls back to local when JSON is unparseable', async () => {
    state.reply = 'sorry I cannot help with that';
    const draft = await parseRecipeFromText('2 cups flour\nMix and bake it now.');
    // extractJson throws → caught → local fallback (guessed)
    expect(draft.fieldConfidence?.ingredients).toBe('guessed');
  });

  it('marks NYT source as extracted, others as parsed', async () => {
    state.reply = JSON.stringify({
      title: 'Z',
      serves: 2,
      ingredients: [{ amount: 1, unit: null, canonicalName: 'egg' }],
      steps: [{ title: 'C', body: 'C.' }],
    });
    const nyt = await parseRecipeFromText('x', { type: 'nyt' });
    expect(nyt.fieldConfidence?.ingredients).toBe('extracted');
    const web = await parseRecipeFromText('x', { type: 'web' });
    expect(web.fieldConfidence?.ingredients).toBe('parsed');
  });
});

describe('not-implemented stubs keep their throwing contract', () => {
  it('inferRecipeFromTranscript throws', async () => {
    await expect(inferRecipeFromTranscript('t')).rejects.toThrow(/not implemented/);
  });
  it('detectTimersAndTemperature throws', async () => {
    await expect(detectTimersAndTemperature('b')).rejects.toThrow(/not implemented/);
  });
  it('generateStepTitle throws', async () => {
    await expect(generateStepTitle('b')).rejects.toThrow(/not implemented/);
  });
  it('matchPipelineKeywords throws', async () => {
    await expect(matchPipelineKeywords('r', [])).rejects.toThrow(/not implemented/);
  });
});
