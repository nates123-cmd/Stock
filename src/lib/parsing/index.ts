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
export {
  parseCookPlanFromText,
  localParseCookPlan,
  detectTimer,
  parseIngredientBullet,
} from './cookPlan';
export type { ParsedCookPlanDraft } from './cookPlan';
export { convertToGrams, findSubstitutes, localGramsFromUnit } from './units';
export { parseIngredientLine } from './freeText';
export type { ParsedLine } from './freeText';
export type { ConvertedIngredient, GramResult, Substitute } from './units';
