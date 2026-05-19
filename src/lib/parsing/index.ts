/** Parsing barrel (spec §11). */
export type { Confidence, Confidenced } from './confidence';
export {
  parseRecipeFromUrl,
  parseRecipeFromPdf,
  parseRecipeFromText,
  inferRecipeFromTranscript,
  detectTimersAndTemperature,
  generateStepTitle,
  matchPipelineKeywords,
  hasApiKey,
  detectSource,
} from './recipe';
export type { ParsedRecipeDraft } from './recipe';
export { parseInstacartPaste, bestGuessIngredients } from './instacart';
export type { ParsedPantryItem } from './instacart';
export { convertRecipe, findSubstitutes } from './units';
export type { ConvertedIngredient, Substitute } from './units';
