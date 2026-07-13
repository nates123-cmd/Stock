/**
 * Pantry shelf categories.
 *
 * The pantry used to be grouped by LOCATION (fridge / freezer / pantry), which
 * meant every shelf-stable thing you own — oil, cumin, flour, pasta, canned
 * tomatoes, crackers — landed in one undifferentiated "Pantry" pile. That's the
 * bucket that made the list feel senseless.
 *
 * The shopping taxonomy (`ShoppingCategory`: produce/dairy/meat/pantry/bakery/
 * frozen/other) has the same flaw and is deliberately NOT reused here: it exists
 * to order a shopping trip by aisle, not to organise a shelf.
 *
 * Location is still kept on the item (it's true, and the buy-loop sets it) —
 * it's just no longer the organising principle.
 */
export type PantryCategory =
  | 'oils'
  | 'spices'
  | 'baking'
  | 'bakery'
  | 'grains'
  | 'canned'
  | 'condiments'
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'frozen'
  | 'snacks'
  | 'drinks'
  | 'other';

export const PANTRY_CATEGORY_ORDER: PantryCategory[] = [
  'produce',
  'dairy',
  'meat',
  'bakery',
  'grains',
  'canned',
  'oils',
  'condiments',
  'spices',
  'baking',
  'frozen',
  'snacks',
  'drinks',
  'other',
];

export const PANTRY_CATEGORY_LABEL: Record<PantryCategory, string> = {
  oils: 'Oils & vinegars',
  spices: 'Spices & seasonings',
  baking: 'Baking',
  bakery: 'Baked goods',
  grains: 'Grains & pasta',
  canned: 'Canned & jarred',
  condiments: 'Condiments & sauces',
  produce: 'Produce',
  dairy: 'Dairy & eggs',
  meat: 'Meat & fish',
  frozen: 'Frozen',
  snacks: 'Snacks',
  drinks: 'Drinks',
  other: 'Other',
};

/**
 * Keyword → category. Ordered most-specific first: the matcher takes the FIRST
 * hit, so entries that would otherwise be stolen by a broader word must come
 * earlier. ("olive oil" must beat "olive"; "coconut milk" must beat "coconut".)
 */
const RULES: [PantryCategory, string[]][] = [
  [
    'oils',
    [
      'olive oil', 'vegetable oil', 'canola oil', 'sesame oil', 'coconut oil',
      'avocado oil', 'peanut oil', 'sunflower oil', 'neutral oil', 'chili oil',
      'chile oil', 'truffle oil', 'ghee', 'shortening', 'cooking spray',
      'balsamic', 'red wine vinegar', 'white vinegar', 'rice vinegar',
      'apple cider vinegar', 'sherry vinegar', 'vinegar', 'oil',
    ],
  ],
  [
    'spices',
    [
      // NOT a bare 'pepper' — that would steal "bell pepper" from Produce.
      'salt', 'black pepper', 'white pepper', 'peppercorn', 'cumin', 'coriander',
      'paprika', 'turmeric',
      'cinnamon', 'nutmeg', 'clove', 'cardamom', 'oregano', 'thyme', 'rosemary',
      'basil leaves', 'bay leaf', 'bay leaves', 'chili powder', 'chile flakes',
      'chili flakes', 'chile flakes', 'red pepper flakes', 'curry powder',
      'garam masala', 'za\'atar', 'sumac', 'saffron', 'ginger powder',
      'garlic powder', 'onion powder', 'cayenne', 'allspice', 'fennel seed',
      'mustard seed', 'sesame seed', 'everything bagel', 'furikake', 'msg',
      'seasoning', 'spice', 'herbs de provence', 'italian seasoning', 'dill',
      'vanilla extract', 'extract',
    ],
  ],
  [
    'baking',
    [
      'flour', 'sugar', 'brown sugar', 'powdered sugar', 'baking powder',
      'baking soda', 'yeast', 'cocoa', 'chocolate chip', 'cornstarch',
      'corn starch', 'molasses', 'honey', 'maple syrup', 'condensed milk',
      'evaporated milk', 'gelatin', 'food coloring',
    ],
  ],
  [
    'bakery',
    [
      'bread', 'baguette', 'sourdough', 'bagel', 'tortilla', 'pita', 'naan',
      'bun', 'roll', 'croissant', 'muffin', 'brioche', 'focaccia', 'crouton',
      'breadcrumb', 'panko',
    ],
  ],
  [
    'grains',
    [
      'rice', 'pasta', 'spaghetti', 'penne', 'noodle', 'ramen', 'orzo', 'couscous',
      'quinoa', 'farro', 'barley', 'oat', 'oatmeal', 'polenta', 'cornmeal',
      'grits', 'lentil', 'bean', 'chickpea', 'cereal', 'granola',
    ],
  ],
  [
    'canned',
    [
      'canned', 'can of', 'jarred', 'tinned', 'tomato paste', 'crushed tomatoes',
      'diced tomatoes', 'coconut milk', 'broth', 'stock', 'anchovy', 'tuna',
      'sardine', 'olives', 'caper', 'pickle', 'artichoke', 'roasted pepper',
      'sun-dried tomato', 'jam', 'jelly', 'preserves', 'peanut butter',
      'almond butter', 'tahini', 'nutella',
    ],
  ],
  [
    'condiments',
    [
      'ketchup', 'mustard', 'mayo', 'mayonnaise', 'soy sauce', 'fish sauce',
      'hot sauce', 'sriracha', 'gochujang', 'miso', 'worcestershire', 'bbq sauce',
      'barbecue sauce', 'salsa', 'hummus', 'pesto', 'marinara', 'pasta sauce',
      'sauce', 'dressing', 'relish', 'harissa', 'chile crisp', 'chili crisp',
      'kimchi', 'sauerkraut',
    ],
  ],
  [
    'frozen',
    ['frozen', 'ice cream', 'popsicle', 'frozen peas', 'puff pastry', 'phyllo'],
  ],
  [
    'dairy',
    [
      'milk', 'cream', 'half and half', 'butter', 'cheese', 'cheddar', 'parmesan',
      'mozzarella', 'feta', 'ricotta', 'yogurt', 'yoghurt', 'sour cream',
      'creme fraiche', 'egg', 'eggs', 'cottage cheese', 'mascarpone',
    ],
  ],
  [
    'meat',
    [
      'chicken', 'beef', 'pork', 'lamb', 'turkey', 'bacon', 'sausage', 'ham',
      'steak', 'ground', 'salmon', 'shrimp', 'fish', 'cod', 'halibut', 'scallop',
      'prosciutto', 'pancetta', 'chorizo', 'tofu', 'tempeh', 'seitan',
    ],
  ],
  [
    'produce',
    [
      'lettuce', 'spinach', 'kale', 'arugula', 'tomato', 'onion', 'shallot',
      'garlic', 'ginger', 'potato', 'carrot', 'celery', 'pepper', 'cucumber',
      'zucchini', 'squash', 'broccoli', 'cauliflower', 'mushroom', 'avocado',
      'lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'berries', 'grape',
      'herb', 'cilantro', 'parsley', 'mint', 'scallion', 'leek', 'cabbage',
      'asparagus', 'corn', 'pea', 'bean sprout', 'radish', 'beet', 'eggplant',
      'basil',
    ],
  ],
  [
    'snacks',
    [
      'chip', 'cracker', 'pretzel', 'popcorn', 'nut', 'almond', 'walnut',
      'pecan', 'cashew', 'pistachio', 'pine nut', 'raisin', 'dried fruit',
      'candy', 'chocolate', 'cookie', 'bar',
    ],
  ],
  [
    'drinks',
    [
      'coffee', 'tea', 'juice', 'soda', 'seltzer', 'sparkling water', 'water',
      'wine', 'beer', 'kombucha', 'cider',
    ],
  ],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `name` contain `phrase` as WHOLE WORD(S)?
 *
 * Plain substring matching was a menace: "chamomile tea" matched `ham` and
 * landed in Meat & fish. Same class of bug for coconut→nut, eggplant→egg,
 * watermelon→water, barley→bar. Anchor on word boundaries, and allow a trailing
 * plural so "tomato" still catches "tomatoes" and "olive" catches "olives".
 */
function hasPhrase(name: string, phrase: string): boolean {
  return new RegExp(`(^|\\W)${escapeRe(phrase)}(e?s)?(\\W|$)`).test(name);
}

/**
 * Best-guess shelf category from an ingredient name. First rule wins, so RULES
 * is ordered most-specific first. Unknown → 'other' — an honest "Other" beats a
 * confidently wrong bucket, and every item can be reassigned by hand anyway.
 */
export function categorizePantryItem(name: string): PantryCategory {
  const n = name.toLowerCase().trim();
  for (const [cat, words] of RULES) {
    for (const w of words) {
      if (hasPhrase(n, w)) return cat;
    }
  }
  return 'other';
}
