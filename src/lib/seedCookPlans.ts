import type { CookPlan } from '@/types';
import { localParseCookPlan } from '@/lib/parsing/cookPlan';

/**
 * First-run Cook Plan seed: Nate's real Friday fried-chicken spread. Built by
 * running the structural parser over the original pasted plan — so the seed
 * doubles as live coverage of `localParseCookPlan`, and the app ships with a
 * worked example of the feature.
 */
const FRIED_CHICKEN_PLAN = `Cooking Plan: Fried Chicken Cook Plan
TONIGHT (before leaving)
Ginger-scallion oil
* 1 cup vegetable oil, heated until shimmering
* 2 cups sliced scallions (~24 scallions)
* 2-inch knob ginger, grated
* Salt the scallions and ginger well, pour hot oil over, cool fully before covering. Improves overnight.
Spice blend / dry brine (mix dry, set aside, apply in AM)
* Kosher salt: 40 g
* Garlic powder: 6 g
* Onion powder: 5 g
* Black pepper: 4 g
* Paprika: 4 g
* Celery salt: 3 g
* Ground mustard: 2 g
* Cayenne: 2 g
* Gochugaru: 3 g (optional)
Nashville dry mix (mix dry, heatproof bowl, set aside until serve time)
* Gochugaru: 22 g (~7-8 tsp)
* Cayenne: 10 g (~5 tsp), up to 14 g for hot
* Brown sugar: 28 g (~7 tsp packed)
* Garlic powder: 5 g (~1.5 tsp)
* Salt: 4 g (~3/4 tsp DC kosher)
* MSG: 2 g (~1/2 tsp, optional)
TOMORROW AM (when back)
Apply dry brine
* Coat all pieces with the 40 g salt-plus-spice blend
* Rack, uncovered, in fridge
* Starts the 8-12 hour clock, lands right for a night cook
Flour dredge (mix anytime tomorrow, sits fine)
* AP flour: 700 g
* Salt: 8-10 g
* Optional: portion of spice blend for a seasoned crust
Slaw dressing (whisk and refrigerate, do NOT dress cabbage yet) Baker's percentages anchored on rice vinegar = 100%
* Rice wine vinegar: 59 g (100%)
* Olive oil: 40 g (68%)
* Sugar / honey / maple: 37 g (63%)
* Soy sauce: 16 g (27%)
* Fresh ginger, grated: 6 g (10%)
* Toasted sesame oil: 5 g to start, up to 14 g to taste (8-24%)
* Garlic, grated: 4 g (7%)
* Salt: 3 g (5%)
* Chili flakes/paste: 1 g (2%, optional)
TOMORROW NIGHT (the cook, in order)
1. Rice on first. Longest passive time, holds warm.
2. Heat fry oil to 325-335 for the first fry.
3. Mix tempura batter cold, right before frying (do NOT make ahead)
    * AP flour: 150 g
    * Cornstarch: 100 g
    * Salt
    * Buttermilk: 200 g
    * Egg whites: 60 g
    * Vodka: 50 g
    * Seltzer: 240 g (straight from fridge)
4. Coat and first-fry. Dredge in seasoned flour, then cold batter, then oil. Fry, rest on a rack. Do all pieces here.
5. Set up the spread while chicken rests. Reheat broth. Plate pickled daikon and cucumber, kimchi, ginger-scallion oil, yuzu buttermilk ranch. Dress the slaw now (toss cabbage, scallions, cilantro), taste for sesame oil top-up.
6. Heat oil to 375 for the second fry.
7. Second fry in batches. Hold finished pieces in a 200 degree oven on a rack so everyone eats together.
8. Brush with Nashville oil (final step). Stir 10-15 g infused garlic oil into the dry mix bowl, ladle ~125 g screaming-hot fry oil over it, whisk to a loose paste, brush each piece.
9. Serve immediately.

The full spread: fried chicken, rice, broth, pickled daikon, cucumber, kimchi, slaw, ginger-scallion oil, yuzu buttermilk ranch, Nashville garlic oil`;

export function seedCookPlans(): CookPlan[] {
  const draft = localParseCookPlan(FRIED_CHICKEN_PLAN);
  return [
    {
      id: 'seed_friedchicken',
      title: draft.title,
      status: 'active',
      spread: draft.spread,
      components: draft.components,
      phases: draft.phases,
      myNotes:
        'The big Friday cook. Acid-forward slaw on purpose — add sesame oil at the end, taste up. First fry can be done 1-2 hours ahead; go-time is just second fry, brush, plate.',
      createdAt: new Date('2026-06-27T02:00:00Z'),
      modifiedAt: new Date('2026-06-27T02:00:00Z'),
      cookCount: 1,
      origin: 'paste',
    },
  ];
}
