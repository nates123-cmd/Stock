/**
 * Deterministic volume → grams for the pantry staples a home cook converts
 * most, plus the plausibility gate every Claude-supplied density must pass.
 *
 * Why this exists: "To grams" used to hand the whole ingredient list to Claude
 * and trust the number that came back. On 2026-09-22 it turned "5 tablespoons
 * sugar" into 38 g (right answer ≈ 63 g) — the model did the arithmetic wrong
 * and nothing checked it. Sugar in a dressing is a taste problem; the same slip
 * on salt, baking soda or yeast ruins the dish.
 *
 * Contract now:
 *   1. Mass units (oz, lb, kg…) convert locally. Always did.
 *   2. Volume units of an ingredient in DENSITY below convert locally — no
 *      Claude call, no rounding drift, same answer every time.
 *   3. Everything else asks Claude for a DENSITY (grams per cup), never a final
 *      gram figure. The multiplication happens here, in code.
 *   4. Any density — Claude's or a future table entry — outside
 *      [MIN_G_PER_ML, MAX_G_PER_ML] is rejected and the ingredient is left
 *      unconverted, with the reason surfaced to the user.
 */

/** US customary + metric volume units → millilitres. Long forms included
 *  because Claude-parsed recipes store "tablespoon" / "teaspoon", not the
 *  short codes the local parser emits. */
const VOLUME_ML: Record<string, number> = {
  tsp: 4.93,
  teaspoon: 4.93,
  teaspoons: 4.93,
  tbsp: 14.79,
  tbs: 14.79,
  tablespoon: 14.79,
  tablespoons: 14.79,
  cup: 236.6,
  cups: 236.6,
  c: 236.6,
  'fl oz': 29.57,
  floz: 29.57,
  'fluid ounce': 29.57,
  'fluid ounces': 29.57,
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  pint: 473.2,
  pints: 473.2,
  quart: 946.4,
  quarts: 946.4,
};

export const ML_PER_CUP = 236.6;

/**
 * Plausibility band for ANY kitchen ingredient measured by volume, in g/mL.
 * Nothing you scoop with a measuring cup is lighter than loose leafy greens
 * / fresh herbs (~0.08, arugula is 20 g a cup) or heavier than molasses /
 * honey (~1.45). Anything outside this band is a model error, not a real
 * food. The floor catches "5 g/cup"-style nonsense, not real salad.
 */
export const MIN_G_PER_ML = 0.05;
export const MAX_G_PER_ML = 1.6;

/**
 * Density table, g/mL, from the standard USDA / King Arthur weight charts.
 * Keys are matched as WHOLE WORDS (in order) against the lowercased
 * canonicalName, so "brown sugar" is checked before "sugar" and
 * "powdered sugar" doesn't fall through to granulated.
 *
 * Only staples where one density covers the common case belong here. Leafy,
 * chopped or shredded items vary too much by prep and stay with Claude.
 */
type DensityEntry = { match: RegExp; gPerMl: number; label: string };

const d = (pattern: string, gPerCup: number, label: string): DensityEntry => ({
  match: new RegExp(`(^|\\b)(${pattern})(\\b|$)`, 'i'),
  gPerMl: gPerCup / ML_PER_CUP,
  label,
});

/** Order matters: more specific patterns first. */
export const DENSITY: DensityEntry[] = [
  // ---- sugars & sweeteners ----
  d('powdered sugar|confectioners?[’\']? sugar|icing sugar', 120, 'powdered sugar'),
  d('(light |dark )?brown sugar|muscovado', 213, 'brown sugar, packed'),
  d('caster sugar|superfine sugar', 225, 'caster sugar'),
  d('coconut sugar', 150, 'coconut sugar'),
  d('(granulated |white |cane |raw |turbinado |demerara )?sugar', 200, 'granulated sugar'),
  d('honey', 340, 'honey'),
  d('maple syrup|golden syrup|corn syrup|agave( nectar| syrup)?', 320, 'syrup'),
  d('molasses', 328, 'molasses'),
  // ---- flours & starches ----
  d('bread flour', 127, 'bread flour'),
  d('cake flour', 114, 'cake flour'),
  d('whole wheat flour|wholemeal flour', 113, 'whole wheat flour'),
  d('almond flour|almond meal', 96, 'almond flour'),
  d('rye flour', 103, 'rye flour'),
  d('rice flour', 158, 'rice flour'),
  d('(all[- ]purpose |ap |plain |white |00 )?flour', 125, 'all-purpose flour'),
  d('corn ?starch|cornflour|arrowroot|potato starch|tapioca (starch|flour)', 128, 'starch'),
  d('cocoa( powder)?|cacao( powder)?', 85, 'cocoa powder'),
  d('cornmeal|polenta', 155, 'cornmeal'),
  d('(rolled |old[- ]fashioned |quick )?oats|oatmeal', 90, 'rolled oats'),
  d('(panko|bread ?crumbs?|breadcrumbs)', 60, 'breadcrumbs'),
  // ---- fats ----
  d('(peanut|almond|cashew|sunflower|nut) butter', 260, 'nut butter'),
  d('butter|margarine|ghee', 227, 'butter'),
  d('shortening|lard|coconut oil', 205, 'solid fat'),
  d('(olive |vegetable |canola |avocado |sesame |peanut |sunflower |grapeseed |neutral |cooking |corn |toasted sesame |extra[- ]virgin olive )?oil(?![- ]packed)', 218, 'oil'),
  // ---- water-like liquids ----
  d('water|stock|broth|coffee|tea|juice|cider|wine|beer|sake|mirin|vinegar|soy sauce|shoyu|tamari|fish sauce|worcestershire( sauce)?|lemon juice|lime juice', 240, 'thin liquid'),
  d('(whole |skim |2% |oat |almond |soy |coconut )?milk|half[- ]and[- ]half|buttermilk|(heavy |whipping |light |double |single )?cream|yogurt|yoghurt|sour cream|crème fraîche|creme fraiche|kefir', 245, 'dairy'),
  d('coconut cream', 240, 'coconut cream'),
  d('mayonnaise|mayo|aioli', 220, 'mayonnaise'),
  d('ketchup|catsup|tomato paste|tomato purée|tomato puree|hoisin( sauce)?|oyster sauce|gochujang|miso|tahini', 260, 'thick sauce or paste'),
  d('vanilla( extract)?|(almond |lemon |peppermint |orange )?extract', 208, 'extract'),
  d('(canned|crushed|diced|whole peeled) tomatoes|tomato sauce|passata|marinara', 245, 'canned tomatoes'),
  // ---- salt, leaveners, dry seasonings ----
  d('kosher salt|flaky salt|flake salt|sea salt flakes|maldon', 145, 'kosher salt'),
  d('(sea |table |fine |pickling |iodized )?salt', 288, 'table salt'),
  d('baking soda|bicarbonate of soda|bicarb', 220, 'baking soda'),
  d('baking powder', 192, 'baking powder'),
  d('(active dry |instant |dry )?yeast', 150, 'yeast'),
  d('msg|monosodium glutamate|accent( seasoning)?|msg seasoning', 150, 'MSG'),
  {
    match: /^(freshly ground |black |white |ground |cracked )*(pepper|peppercorns?)$/i,
    gPerMl: 110 / ML_PER_CUP,
    label: 'ground pepper',
  },
  d('ground (ginger|cloves|coriander|cumin|cinnamon|nutmeg|cardamom|allspice|turmeric|mustard)', 110, 'ground spice'),
  d('(smoked |sweet |hot )?(cumin|paprika|turmeric|cinnamon|nutmeg|cardamom|allspice|chili powder|chilli powder|curry powder|garam masala|cayenne|garlic powder|onion powder|five[- ]spice|dried oregano|dried thyme|dried basil|italian seasoning)', 110, 'ground spice'),
  d('sesame seeds?|poppy seeds?|chia seeds?|flax ?seeds?|linseed', 150, 'small seeds'),
  // ---- grains, legumes, nuts (dry, uncooked) ----
  d('(white |brown |jasmine |basmati |long[- ]grain |short[- ]grain |sushi |arborio )?rice', 190, 'dry rice'),
  d('quinoa|couscous|bulgur|farro|barley|millet', 175, 'dry grain'),
  d('(dried |dry |red |green |brown |black )?(lentils?|split peas|chickpeas?|garbanzo beans?)', 190, 'dry legumes'),
  d('(canned |cooked )?(black beans|kidney beans|pinto beans|cannellini beans|white beans|navy beans)', 175, 'cooked beans'),
  d('(sliced |slivered |toasted |chopped |whole |raw |roasted )*(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|peanuts?|pine nuts?|macadamias?)', 110, 'nuts'),
  d('(shredded |desiccated |flaked )?coconut', 85, 'shredded coconut'),
  d('chocolate chips?|chocolate chunks?', 170, 'chocolate chips'),
  d('raisins|sultanas|currants|dried cranberries|dried cherries', 150, 'dried fruit'),
  // ---- cooked / prepared with a stable density ----
  d('(shelled |frozen )?edamame', 155, 'edamame'),
  d('(frozen |canned |sweet )?corn( kernels)?', 165, 'corn kernels'),
  d('(frozen |green )?peas', 145, 'peas'),
  d('(grated |shredded )?(parmesan|parmigiano|pecorino|cheddar|mozzarella|gruy[èe]re|feta|cheese)', 100, 'shredded cheese'),
];

/** Normalise a unit string to the VOLUME_ML key it matches, else null. */
export function volumeMl(unit: string | null | undefined): number | null {
  if (!unit) return null;
  const key = unit.trim().toLowerCase().replace(/\.$/, '');
  return VOLUME_ML[key] ?? null;
}

/** Table lookup for one ingredient name. Returns the matched entry or null. */
export function densityFor(canonicalName: string): DensityEntry | null {
  const name = canonicalName.trim().toLowerCase();
  if (!name) return null;
  for (const entry of DENSITY) if (entry.match.test(name)) return entry;
  return null;
}

export type LocalGrams = {
  grams: number;
  /** which table row decided this — surfaced for tests and the hint line */
  via: string;
};

/**
 * Volume amount of a KNOWN ingredient → grams, purely from the tables above.
 * Null when the unit isn't a volume unit or the ingredient isn't in DENSITY;
 * the caller then falls through to Claude.
 */
export function localGramsFromVolume(
  canonicalName: string,
  amount: number | null,
  unit: string | null,
): LocalGrams | null {
  if (amount == null || !(amount > 0)) return null;
  const ml = volumeMl(unit);
  if (ml == null) return null;
  const entry = densityFor(canonicalName);
  if (!entry) return null;
  return { grams: Math.round(amount * ml * entry.gPerMl), via: entry.label };
}

/**
 * Is this density physically possible for something measured in a kitchen?
 * Used to gate every value Claude returns before it becomes a recipe amount.
 */
export function plausibleDensity(gPerMl: number): boolean {
  return Number.isFinite(gPerMl) && gPerMl >= MIN_G_PER_ML && gPerMl <= MAX_G_PER_ML;
}
