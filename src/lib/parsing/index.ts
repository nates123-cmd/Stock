/** Parsing barrel (spec §11). */
export type { Confidence, Confidenced } from './confidence';
export {
  parseRecipeFromUrl,
  parseRecipeFromPdf,
  parseRecipeFromImage,
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
export { localParseRecipe } from './localRecipe';
export { convertToGrams, findSubstitutes } from './units';
export type { ConvertedIngredient, GramResult, Substitute } from './units';
