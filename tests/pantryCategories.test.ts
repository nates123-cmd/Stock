import { describe, expect, it } from 'vitest';
import { categorizePantryItem } from '@/lib/pantryCategories';

describe('pantry categorizer: word-boundary matching', () => {
  it('does not put chamomile tea in meat (ham was matching as a substring)', () => {
    expect(categorizePantryItem('chamomile tea')).toBe('drinks');
  });
  it('avoids the other substring traps', () => {
    expect(categorizePantryItem('coconut')).not.toBe('snacks');   // 'nut'
    expect(categorizePantryItem('eggplant')).toBe('produce');      // 'egg'
    expect(categorizePantryItem('watermelon')).not.toBe('drinks'); // 'water'
    expect(categorizePantryItem('barley')).toBe('grains');         // 'bar'
  });
  it('still classifies the obvious things', () => {
    expect(categorizePantryItem('olive oil')).toBe('oils');
    expect(categorizePantryItem('black pepper')).toBe('spices');
    expect(categorizePantryItem('kosher salt')).toBe('spices');
    expect(categorizePantryItem('panko breadcrumbs')).toBe('bakery');
    expect(categorizePantryItem('chicken thighs')).toBe('meat');
    expect(categorizePantryItem('ice cream')).toBe('frozen');
    expect(categorizePantryItem('bell pepper')).toBe('produce');
    expect(categorizePantryItem('tomatoes')).toBe('produce');
    expect(categorizePantryItem('peanut butter')).toBe('canned');
  });
});
