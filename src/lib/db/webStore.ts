/**
 * Native stub. On iOS/android the stores persist to SQLite (repositories.ts);
 * this never runs. Metro resolves `webStore.web.ts` for the web build.
 */
export const webPersist = {
  available: false,
  async load<T>(_name: string): Promise<T | null> {
    return null;
  },
  async save<T>(_name: string, _value: T): Promise<void> {
    /* no-op on native */
  },
};
