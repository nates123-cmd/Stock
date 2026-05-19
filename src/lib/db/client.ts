import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

/**
 * SQLite access for the local-first store (spec §4). One database, opened
 * lazily, migrated on first access.
 *
 * Web note: expo-sqlite's web (WASM) path is initialized async. v1 targets
 * iOS/Android (spec §12); this guard keeps the web bundle bootable for
 * preview without a real DB. Wire the async web init in v1.x if web becomes
 * a real target.
 */
const DB_NAME = 'stock.db';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (Platform.OS === 'web') {
    throw new Error(
      '[stock/db] SQLite is not initialized on web in v1 — native only (spec §12).',
    );
  }
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
  }
  return db;
}

/** Run pending migrations. Idempotent; safe to call on every app start. */
export async function migrate(): Promise<void> {
  if (Platform.OS === 'web') return;
  const database = getDb();

  const row = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const stmt of SCHEMA_STATEMENTS) {
      await tx.execAsync(stmt);
    }
    // user_version can't be parameterized; SCHEMA_VERSION is an in-code int.
    await tx.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}
