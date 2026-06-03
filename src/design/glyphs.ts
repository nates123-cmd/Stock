/**
 * Glyph vocabulary — spec §2 "Glyph vocabulary".
 *
 * NEVER use emojis. These are Unicode symbols / typographic marks rendered as
 * text. The week-plan letter-tags (D/B in disks) supersede any emoji usage in
 * earlier mockups; the no-emoji rule is global (spec §13).
 */
export const glyph = {
  recipes: '▤', // Recipes / library / list
  pipeline: '◔', // Pipeline / partial-circle = incomplete
  bench: '▦', // Bench / workbench (crosshatch worktop). NOT ⚖ — U+2696 has
  //               emoji presentation, rendered colorful next to the other
  //               monochrome geometric glyphs. ▦ stays text-style + on-family.
  pantry: '▣', // Pantry / inventory
  plan: '◷', // Plan / week / time
  next: '→', // Next action, navigation
  back: '←', // Back
  undo: '↺', // Undo
  done: '✓', // Done / cooked / success
  add: '+', // Add / new
  sep: '·', // Separator in meta lines
  expand: '▾', // Expand / dropdown
  pageLeft: '‹', // Pagination / week-nav
  pageRight: '›',
  timer: '⏱', // Timer prefix in step text
  close: '✕', // Dismiss / close overlay
} as const;

export type GlyphName = keyof typeof glyph;

/** Meal-type markers used in the week plan (single letter inside a disk). */
export const mealMarker = {
  dinner: 'D', // primary — espresso-filled disk
  breakfast: 'B', // secondary — cream/outlined disk
  lunch: 'L', // secondary — cream/outlined disk (sibling of breakfast)
} as const;
