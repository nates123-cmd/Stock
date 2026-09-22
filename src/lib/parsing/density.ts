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
 * Nothing you scoop with a measuring cup is lighter than fresh dill sprigs
 * (10 g a cup, 0.04) or loose arugula (20 g, 0.08), or heavier than
 * molasses / honey (~1.45). Anything outside this band is a model error,
 * not a real food. The floor catches "5 g/cup"-style nonsense, not salad.
 */
export const MIN_G_PER_ML = 0.03;
export const MAX_G_PER_ML = 1.6;

/**
 * Density table, g/mL. Values are grams per US cup from King Arthur's
 * ingredient weight chart (baking staples, checked 2026-09-22) and USDA
 * FoodData Central (produce, herbs, condiments). Keys are matched as WHOLE
 * WORDS, first hit wins, so specific rows sit above general ones ("brown
 * sugar" before "sugar", "peanut butter" before "butter", "olive oil"
 * before "olives").
 *
 * Built from Nate's own recipes: every ingredient that appears measured by
 * the cup or spoon more than once is here, or was left out on purpose
 * because its density depends on prep (orzo, fried shallots) and Claude
 * with the plausibility gate does better than a wrong constant.
 */
type DensityEntry = { match: RegExp; gPerMl: number; label: string };

const d = (pattern: string, gPerCup: number, label: string): DensityEntry => ({
  match: new RegExp(`(^|\\b)(${pattern})(\\b|$)`, 'i'),
  gPerMl: gPerCup / ML_PER_CUP,
  label,
});

/** Order matters: more specific patterns first. */
export const DENSITY: DensityEntry[] = [
  // ---- sugars & sweeteners (KA) ----
  d('powdered sugar|confectioners?[’\']? sugar|icing sugar', 115, 'powdered sugar'),
  d('(light |dark )?brown sugar|muscovado', 213, 'brown sugar, packed'),
  d('caster sugar|superfine sugar', 225, 'caster sugar'),
  d('coconut sugar', 150, 'coconut sugar'),
  d('(granulated |white |cane |raw |turbinado |demerara )?sugar', 200, 'granulated sugar'),
  d('honey', 336, 'honey'),
  d('maple syrup|golden syrup|corn syrup|agave( nectar| syrup)?', 312, 'syrup'),
  d('molasses', 340, 'molasses'),
  // ---- flours & starches (KA / USDA) ----
  d('bread flour', 127, 'bread flour'),
  d('cake flour', 114, 'cake flour'),
  d('whole wheat flour|wholemeal flour', 113, 'whole wheat flour'),
  d('almond flour|almond meal', 96, 'almond flour'),
  d('rye flour', 106, 'rye flour'),
  d('rice flour', 150, 'rice flour'),
  d('(all[- ]purpose |ap |plain |white |00 )?flour', 125, 'all-purpose flour'),
  d('corn ?starch|cornflour|arrowroot|potato starch|tapioca (starch|flour)', 120, 'starch'),
  d('cocoa( powder)?|cacao( powder)?', 84, 'cocoa powder'),
  d('cornmeal|polenta', 138, 'cornmeal'),
  d('(rolled |old[- ]fashioned |quick )?oats|oatmeal', 90, 'rolled oats'),
  d('panko( bread ?crumbs?)?', 50, 'panko'),
  d('(dried |dry |fine |fresh )?(bread ?crumbs?|breadcrumbs)', 112, 'dried breadcrumbs'),
  // ---- fats (KA) ----
  d('(peanut|almond|cashew|sunflower|nut) butter', 270, 'nut butter'),
  d('butter|margarine|ghee', 227, 'butter'),
  d('shortening|lard|coconut oil', 205, 'solid fat'),
  d('(olive |vegetable |canola |avocado |sesame |peanut |sunflower |grapeseed |neutral |cooking |corn |toasted sesame |extra[- ]virgin olive |chili |chile )?oil(?![- ]packed)', 218, 'oil'),
  // ---- zest before the juice/liquid row catches "lemon" ----
  d('(finely grated |grated )?(lemon|lime|orange|citrus) zest|zest', 96, 'citrus zest'),
  // ---- water-like liquids (USDA 1 cup water = 237 g) ----
  d('water|stock|broth|coffee|tea|juice|cider|wine|beer|sake|mirin|vinegar|soy sauce|shoyu|tamari|fish sauce|worcestershire( sauce)?|lemon juice|lime juice|lemon|lime', 240, 'thin liquid'),
  d('vodka|gin|rum|whisk(e)?y|bourbon|tequila|brandy|mezcal', 224, 'spirits'),
  d('(whole |skim |2% |oat |almond |soy |coconut )?milk|half[- ]and[- ]half|buttermilk|(heavy |whipping |light |double |single )?cream|yogurt|yoghurt|sour cream|crème fraîche|creme fraiche|kefir|cream cheese', 240, 'dairy'),
  d('coconut cream', 240, 'coconut cream'),
  d('mayonnaise|mayo|aioli', 226, 'mayonnaise'),
  // ---- pastes, condiments, sauces (USDA; 1 tbsp ≈ 15-16 g) ----
  d('ketchup|catsup|tomato paste|tomato purée|tomato puree|hoisin( sauce)?|oyster sauce|gochujang|miso|tahini|(dijon|whole[- ]grain|wholegrain|yellow|prepared|english|brown|spicy) mustard(?! seeds?| powder)|dijon|harissa( paste)?|(red |green |yellow |thai |massaman |panang )?curry paste|sambal( oelek)?|sriracha|chil[ei] crisp|chil[ei] garlic sauce|pesto|(prepared )?horseradish|hot sauce|(bbq|barbecue) sauce|hummus|doubanjiang|black bean (sauce|paste)|shrimp paste|anchovy paste', 250, 'thick sauce or paste'),
  d('vanilla( extract)?|(almond |lemon |peppermint |orange )?extract', 220, 'extract'),
  d('(canned|crushed|diced|whole peeled) tomatoes|tomato sauce|passata|marinara', 245, 'canned tomatoes'),
  d('pumpkin purée|pumpkin puree|canned pumpkin|(sweet potato|squash|butternut) purée|(sweet potato|squash|butternut) puree|applesauce|apple sauce', 230, 'purée'),
  // ---- salt, leaveners (KA) ----
  d('kosher salt|flaky salt|flake salt|sea salt flakes|maldon', 145, 'kosher salt'),
  d('(sea |table |fine |pickling |iodized |garlic |celery |seasoned |flaky )?salt', 288, 'table salt'),
  d('baking soda|bicarbonate of soda|bicarb', 220, 'baking soda'),
  d('baking powder', 192, 'baking powder'),
  d('(active dry |instant |dry |nutritional )?yeast', 144, 'yeast'),
  d('msg|monosodium glutamate|accent( seasoning)?|msg seasoning|bouillon( powder)?|(chicken|beef|vegetable) bouillon', 150, 'MSG / bouillon'),
  {
    match: /^(freshly ground |black |white |ground |cracked )*(pepper|peppercorns?)$/i,
    gPerMl: 110 / ML_PER_CUP,
    label: 'ground pepper',
  },
  // ---- ground spices (USDA: cumin 2.1 g/tsp, paprika 2.3, cinnamon 2.6, turmeric 3) ----
  d('ground (ginger|cloves|coriander|cumin|cinnamon|nutmeg|cardamom|allspice|turmeric|mustard|fennel|sumac)|mustard powder', 110, 'ground spice'),
  d('(smoked |sweet |hot |hungarian |spanish )?(cumin|paprika|turmeric|cinnamon|nutmeg|cardamom|allspice|chili powder|chilli powder|curry powder|garam masala|cayenne|garlic powder|onion powder|five[- ]spice|pumpkin (pie )?spice|ras el hanout|berbere|baharat|old bay|taco seasoning|chinese five spice)', 110, 'ground spice'),
  // ---- dried leaf herbs (USDA: oregano / thyme 1 g per tsp) ----
  d('(dried |dry )?(oregano|thyme|rosemary|marjoram|tarragon|sage|bay leaves|dill weed)( leaves)?|dried (basil|mint|cilantro|parsley|chives|dill)|italian seasoning|herbes de provence|herbs de provence', 45, 'dried leaf herb'),
  // ---- whole / flaked spices (USDA: red pepper flakes 1.8 g/tsp, fennel seed 2 g/tsp) ----
  d('red[- ]pepper flakes|crushed red pepper( flakes)?|chil[ei] flakes|aleppo( pepper)?|gochugaru|(sichuan|szechuan) pepper(corns?)?|urfa|(fennel|cumin|coriander|mustard|caraway|cardamom|celery|nigella|anise) seeds?|coriander|sumac|za[’\']?atar|dukkah|(whole )?(?<!garlic )(cloves|star anise|allspice berries)', 90, 'whole spice'),
  d('sesame seeds?|poppy seeds?|chia seeds?|flax ?seeds?|linseed|hemp seeds?', 150, 'small seeds'),
  d('pumpkin seeds?|pepitas', 160, 'pumpkin seeds'),
  d('sunflower seeds?', 140, 'sunflower seeds'),
  // ---- fresh herbs (USDA: cilantro 16 g/cup, parsley chopped 60, basil 24-42, chives 48) ----
  d('(fresh |chopped |torn )*(cilantro|coriander leaves)( leaves)?', 16, 'cilantro'),
  d('(fresh |flat[- ]leaf |italian |curly |chopped )*parsley( leaves)?', 60, 'parsley'),
  d('(fresh |thai |chopped |torn )*basil( leaves)?', 30, 'basil'),
  d('(fresh |chopped |torn )*mint( leaves)?', 40, 'mint'),
  d('(fresh |chopped )*dill( fronds| sprigs)?', 10, 'dill'),
  d('(fresh |chopped )*chives', 48, 'chives'),
  d('(fresh |mixed |chopped |soft )*herbs|fresh basil or cilantro|fresh rosemary or thyme', 30, 'fresh herbs'),
  d('(chopped |sliced |thinly sliced )*(scallions?|green onions?|spring onions?)', 100, 'scallions'),
  // ---- leafy greens (USDA: arugula 20 g/cup, spinach 30, lettuce 36-47) ----
  d('(baby )?(arugula|rocket)( leaves)?', 20, 'arugula'),
  d('(baby |fresh )?spinach( leaves)?', 30, 'spinach'),
  d('(baby |chopped |shredded )*kale( leaves)?', 20, 'kale'),
  d('(salad |mixed |baby |spring )?greens|mesclun|(romaine |iceberg |butter |little gem )?lettuce|watercress|microgreens|(shredded |chopped )?cabbage|slaw mix', 40, 'salad greens'),
  // ---- produce measured by the cup (USDA) ----
  d('(cherry|grape|sun ?gold) tomatoes', 150, 'cherry tomatoes'),
  d('(red |yellow |white |sweet |vidalia |spanish )?onions?|shallots?', 160, 'chopped onion'),
  d('(minced |chopped |grated )?garlic', 136, 'minced garlic'),
  d('(fresh |grated |minced |chopped )*ginger', 96, 'grated ginger'),
  d('(kalamata|castelvetrano|green|black|niçoise|nicoise|pitted|sliced|mixed) olives|olives|kalamatas?|castelvetranos?', 135, 'olives'),
  d('capers', 140, 'capers'),
  d('pomegranate (seeds|arils)', 174, 'pomegranate arils'),
  d('(shelled |frozen )?edamame', 155, 'edamame'),
  d('(frozen |canned |sweet )?corn( kernels)?', 165, 'corn kernels'),
  d('(frozen |green )?peas', 145, 'peas'),
  d('(grated |shredded |crumbled )?(parmesan|parmigiano|pecorino|cheddar|mozzarella|gruy[èe]re|feta|goat cheese|cotija|cheese)', 100, 'shredded cheese'),
  // ---- grains, legumes (KA / USDA) ----
  d('(white |brown |jasmine |basmati |long[- ]grain |short[- ]grain |sushi |arborio )?rice', 195, 'dry rice'),
  d('quinoa|couscous|bulgur|farro|barley|millet', 177, 'dry grain'),
  d('(dried |dry )(lentils?|chickpeas?|garbanzo beans?|beans)|split peas', 200, 'dry legumes'),
  d('(red |green |brown |black |french |cooked )?lentils?', 195, 'lentils'),
  d('(canned |cooked |drained )?(chickpeas?|garbanzo beans?|black beans|kidney beans|pinto beans|cannellini beans|white beans|navy beans|butter beans)', 165, 'cooked beans'),
  // ---- nuts & dried fruit (KA: sliced almonds 86, whole 142, walnuts 113, pine nuts 142) ----
  d('(sliced|slivered)( [a-z-]+){0,2} almonds?|almonds?, (sliced|slivered)', 90, 'sliced almonds'),
  d('(toasted |chopped |raw |roasted |whole |blanched |marcona )*(almonds?|hazelnuts?|peanuts?|macadamias?|pine nuts?|pinenuts?)', 142, 'whole nuts'),
  d('(shelled |toasted |chopped |raw |roasted )*pistachios?( nuts)?', 120, 'pistachios'),
  d('(sliced |toasted |chopped |raw |roasted |whole |halved )*(walnuts?|pecans?|cashews?)( halves| pieces)?', 113, 'walnuts / pecans / cashews'),
  d('(shredded |desiccated |flaked )?coconut', 85, 'shredded coconut'),
  d('chocolate chips?|chocolate chunks?', 170, 'chocolate chips'),
  d('raisins|sultanas|currants|dried cranberries|dried cherries|dried apricots|dates', 150, 'dried fruit'),
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
