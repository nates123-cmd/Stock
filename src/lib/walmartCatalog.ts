/**
 * Nate's pinned Walmart SKUs — harvested from My Items → Reorder (his own
 * purchase history) on 2026-08-03, against store 5293 (200 Moffat St, Valley
 * Stream Supercenter).
 *
 * Why a bundled catalog instead of a live lookup: Walmart's search page carries
 * everything we need (item id, price, in-stock, store-vs-shipped) but it is
 * behind PerimeterX, which challenges *any* automated browser — headless or
 * not, real-Chrome channel or not. Only a warm human session gets through. A
 * pinned catalog sidesteps that entirely for the items Nate actually buys,
 * which is most of them, and makes the whole push a client-side deep link with
 * no backend at all.
 *
 * `price` is a SNAPSHOT for estimating a basket, not a quote — Walmart's cart
 * shows the real total (and its own promos) before Nate ever checks out. Treat
 * a stale price as a rough number, never as a promise.
 *
 * To extend: open walmart.com/my-items signed in, or just add the id from any
 * product URL — walmart.com/ip/<slug>/<itemId>.
 */

export type WalmartProduct = {
  itemId: string;
  name: string;
  /** Snapshot price in dollars at harvest time. */
  price: number;
  category: 'produce' | 'refrigerated' | 'meat' | 'pantry' | 'beverages' | 'personal care' | 'home';
  /**
   * Where it comes from — Walmart's own `fulfillmentType`, checked per SKU on
   * 2026-08-03.
   *
   * `store`  — picked at store 5293, so it can ride a same-day DELIVERY slot.
   * `ship`   — warehouse (FC) or marketplace; lands in a separate cart group
   *            and arrives in days.
   *
   * This is not cosmetic. Nate asked for delivery specifically, and the two
   * are indistinguishable in the catalog otherwise: the arborio rice sitting
   * under "Pantry" in his own reorder list SHIPS. Without this flag a basket
   * would quietly promise same-day on something arriving Wednesday.
   */
  fulfillment: 'store' | 'ship';
  /** Out of stock at the store when harvested. Stale — treat as a hint. */
  outOfStock?: boolean;
};

export const WALMART_STORE = {
  id: '5293',
  name: 'Valley Stream Supercenter',
  address: '200 Moffat St',
  harvestedAt: '2026-08-03',
} as const;

export const WALMART_PRODUCTS: WalmartProduct[] = [
  { itemId: '10447842', name: 'Fresh Yellow Onions, 3 lb Bag', price: 4.84, category: 'produce', fulfillment: 'store' },
  { itemId: '998269547', name: 'Marketside Organic Baby Arugula Salad, 5 oz', price: 2.96, category: 'produce', fulfillment: 'store' },
  { itemId: '17358255648', name: 'Fresh Whole Shallots, 16 oz Bag', price: 3.24, category: 'produce', fulfillment: 'store' },
  { itemId: '10402651', name: 'Crisp Fresh Celery Hearts', price: 3.67, category: 'produce', fulfillment: 'store' },
  { itemId: '10535757', name: 'Fresh Whole Carrots, 2 lb Bag', price: 2.26, category: 'produce', fulfillment: 'store' },
  { itemId: '44391168', name: 'Fresh Italian Parsley Bunch, Each', price: 0.92, category: 'produce', fulfillment: 'store' },
  { itemId: '3953481268', name: 'Fresh Thyme, 0.5 oz Clamshell', price: 1.78, category: 'produce', fulfillment: 'store' },
  { itemId: '640611294', name: 'Franklin Farms Firm Tofu, 16 oz', price: 3.26, category: 'refrigerated', fulfillment: 'store' },
  { itemId: '5022271829', name: 'Greco Halloumi Cheese Chunk, 7.9 oz', price: 5.97, category: 'refrigerated', outOfStock: true, fulfillment: 'store' },
  { itemId: '136650131', name: 'Chuck Short Ribs, Choice Angus Beef, Bone-in', price: 17.68, category: 'meat', fulfillment: 'store' },
  { itemId: '55504313', name: 'Tropical Plantation Avocado Oil, 51 fl oz', price: 19.48, category: 'pantry', fulfillment: 'ship' },
  { itemId: '10403515', name: 'RiceSelect Arborio Rice, 2 lb Jar', price: 7.63, category: 'pantry', fulfillment: 'ship' },
  { itemId: '10295082', name: "Hunt's Tomato Paste, 6 oz Can", price: 1.16, category: 'pantry', fulfillment: 'store' },
  { itemId: '25516475', name: 'Bragg Organic Apple Cider Vinegar, 16 fl oz', price: 4.48, category: 'pantry', fulfillment: 'ship' },
  { itemId: '195667370', name: 'Laoganma Spicy Chili Crisp Sauce, 7.41 fl oz', price: 4.97, category: 'pantry', fulfillment: 'store' },
  { itemId: '339917415', name: 'Traditional Medicinals Throat Coat Tea, 16 ct', price: 5.88, category: 'beverages', fulfillment: 'ship' },
  { itemId: '23658488', name: 'Yogi Bedtime Sleep Tea, 16 ct', price: 4.46, category: 'beverages', outOfStock: true, fulfillment: 'ship' },
  { itemId: '1071573732', name: 'Dial Gold Antibacterial Bar Soap, 4 oz', price: 1.36, category: 'personal care', fulfillment: 'ship' },
  { itemId: '258282365', name: 'Softsoap Aloe Liquid Hand Soap, 6 pack', price: 8.34, category: 'personal care', fulfillment: 'ship' },
  { itemId: '569761884', name: 'Colgate Total Whitening Toothpaste, Mint', price: 7.31, category: 'personal care', fulfillment: 'ship' },
  { itemId: '851565628', name: 'Crest Pro-Health Gum Detoxify Mouthwash', price: 7.17, category: 'personal care', fulfillment: 'ship' },
  { itemId: '39126487', name: 'Cremo Original Shaving Cream, 6 fl oz', price: 7.26, category: 'personal care', fulfillment: 'ship' },
  { itemId: '488010292', name: 'Cremo 2-in-1 Shampoo & Conditioner, 16 fl oz', price: 9.97, category: 'personal care', fulfillment: 'ship' },
  { itemId: '367581884', name: "Harry's Razor Blade Refills", price: 15.44, category: 'personal care', fulfillment: 'ship' },
  { itemId: '2500828856', name: "Harry's Antiperspirant Deodorant", price: 5.47, category: 'personal care', fulfillment: 'ship' },
  { itemId: '1115403', name: 'Gillette Foamy Sensitive Shave Foam', price: 3.02, category: 'personal care', fulfillment: 'store' },
  { itemId: '12442999', name: 'Afta After Shave Lotion, Fresh Scent', price: 2.72, category: 'personal care', fulfillment: 'store' },
  { itemId: '132593578', name: 'Gillette Pro Glide Power Razor Handle', price: 13.97, category: 'personal care', fulfillment: 'ship' },
  { itemId: '472733669', name: 'joy Razor for Women, 5 blades', price: 10.43, category: 'personal care', fulfillment: 'ship' },
  { itemId: '200928631', name: 'Gillette Sensor 2 Plus Razors', price: 14.44, category: 'personal care', fulfillment: 'ship' },
  { itemId: '241151078', name: "Dr. Brown's Toddler Toothbrush", price: 5.39, category: 'personal care', fulfillment: 'ship' },
  { itemId: '24660672', name: 'Cotton Bib Apron, 28" x 35"', price: 5.98, category: 'home', fulfillment: 'ship' },
  { itemId: '1206793530', name: 'Mainstays 2 Quart Round Slow Cooker', price: 12.64, category: 'home', fulfillment: 'ship' },
  { itemId: '401966660', name: 'IMUSA 3.75in Granite Mortar & Pestle', price: 14.96, category: 'home', fulfillment: 'ship' },
  { itemId: '827247210', name: 'Mainstays Cereal Dispenser, 16 cups', price: 5.97, category: 'home', fulfillment: 'ship' },
  { itemId: '910785698', name: 'Ball Wide Mouth Storage Lid', price: 6.79, category: 'home', fulfillment: 'ship' },
  { itemId: '5170438169', name: 'Thyme and Table Silicone Mini Utensil Set', price: 6.76, category: 'home', fulfillment: 'ship' },
  { itemId: '15142500442', name: 'Sterilite 27 Gallon Storage Tote, 6 pack', price: 54.88, category: 'home', fulfillment: 'ship' },
];

/**
 * What Stock calls a thing → the exact SKU Nate buys.
 *
 * Pins beat fuzzy matching every time, and they're the difference between
 * "cooking oil" landing on the avocado oil he actually uses and landing on
 * whatever ranked first. Add a line here whenever a push guesses wrong.
 */
export const WALMART_ALIASES: Record<string, string> = {
  onion: '10447842',
  onions: '10447842',
  'yellow onion': '10447842',
  'yellow onions': '10447842',
  arugula: '998269547',
  'baby arugula': '998269547',
  shallot: '17358255648',
  shallots: '17358255648',
  celery: '10402651',
  carrot: '10535757',
  carrots: '10535757',
  parsley: '44391168',
  'italian parsley': '44391168',
  'flat leaf parsley': '44391168',
  thyme: '3953481268',
  tofu: '640611294',
  'firm tofu': '640611294',
  halloumi: '5022271829',
  'short ribs': '136650131',
  'beef short ribs': '136650131',
  'avocado oil': '55504313',
  'arborio rice': '10403515',
  'tomato paste': '10295082',
  'apple cider vinegar': '25516475',
  'chili crisp': '195667370',
  'throat coat tea': '339917415',
  'bedtime tea': '23658488',
  'hand soap': '258282365',
  'bar soap': '1071573732',
  toothpaste: '569761884',
  mouthwash: '851565628',
  'shaving cream': '39126487',
  shampoo: '488010292',
  conditioner: '488010292',
  deodorant: '2500828856',
};

export const WALMART_BY_ID: Record<string, WalmartProduct> = Object.fromEntries(
  WALMART_PRODUCTS.map((p) => [p.itemId, p]),
);
