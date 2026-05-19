/**
 * Web persistence (spec §4, web variant) — Stock is a real suite PWA, so the
 * web build must keep data across reloads, not just preview it.
 *
 * IndexedDB via idb-keyval. IndexedDB uses the structured-clone algorithm,
 * which preserves `Date` objects — so collections round-trip without the
 * ISO-string revival the SQLite layer needs. Works on plain static hosting
 * (serve:web, GitHub Pages); no COOP/COEP, unlike expo-sqlite's wasm build.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval';

const key = (name: string) => `stock:${name}`;

export const webPersist = {
  available: true,
  async load<T>(name: string): Promise<T | null> {
    try {
      return ((await idbGet(key(name))) as T | undefined) ?? null;
    } catch (e) {
      console.warn('[stock] web load failed', name, e);
      return null;
    }
  },
  async save<T>(name: string, value: T): Promise<void> {
    try {
      await idbSet(key(name), value);
    } catch (e) {
      console.warn('[stock] web save failed', name, e);
    }
  },
};
