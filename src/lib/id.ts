/**
 * Local id generator. v1 is local-first single-user (spec §4/§14.1), so a
 * short collision-resistant string is sufficient — no need for uuid yet.
 */
export function uid(prefix = ''): string {
  const s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${s}` : s;
}
