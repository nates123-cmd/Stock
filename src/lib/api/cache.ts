import { Platform } from 'react-native';

/**
 * AI result cache (spec §11 "Caching"). Native persists in the ai_cache table
 * so common patterns survive restarts; web uses a session Map (no SQLite —
 * spec §12). Shape matches ClaudeCallOptions.cache.
 */
const mem = new Map<string, string>();

export function makeAiCache(task: string) {
  if (Platform.OS === 'web') {
    return {
      get: async (k: string) => mem.get(k) ?? null,
      set: async (k: string, v: string) => void mem.set(k, v),
    };
  }
  // Lazy require so web never pulls expo-sqlite into this path.
  const { getDb } = require('@/lib/db/client') as typeof import('@/lib/db/client');
  return {
    get: async (k: string): Promise<string | null> => {
      try {
        const row = await getDb().getFirstAsync<{ result: string }>(
          'SELECT result FROM ai_cache WHERE cache_key = ?',
          k,
        );
        return row?.result ?? null;
      } catch {
        return null;
      }
    },
    set: async (k: string, v: string): Promise<void> => {
      try {
        await getDb().runAsync(
          `INSERT INTO ai_cache (cache_key, task, result, created_at)
           VALUES (?,?,?,?)
           ON CONFLICT(cache_key) DO UPDATE SET result=excluded.result`,
          k,
          task,
          v,
          new Date().toISOString(),
        );
      } catch {
        /* cache write best-effort */
      }
    },
  };
}
