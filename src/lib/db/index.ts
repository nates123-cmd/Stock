/** Local-first storage barrel (spec §4). */
export { getDb, migrate } from './client';
export { SCHEMA_VERSION } from './schema';
export {
  recipeRepo,
  cookRepo,
  cookPlanRepo,
  planRepo,
  pantryRepo,
  pipelineRepo,
} from './repositories';
