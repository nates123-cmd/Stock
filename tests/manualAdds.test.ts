import { describe, it, expect } from 'vitest';
import {
  isManualExtra,
  isDeliberateExtra,
  MANUAL_ACTIVE,
  MANUAL_STAPLE,
  PLAN_WIZARD,
} from '../src/lib/shopping';

/**
 * The rule: anything you add to the shopping list BY HAND stays on the list.
 * It trumps every automatic hide — a check-off left over from a past shop (the
 * `checked` map in have.ts is permanent), an always-have pin, a pantry
 * `isStaple` flag, a low/out status. That was the "I can't add pine nuts, it
 * just disappears" bug: a name Nate had ever bought before was swallowed the
 * instant he re-added it.
 */
describe('manual shopping-list adds', () => {
  it('recognizes both manual origins', () => {
    expect(isManualExtra(MANUAL_ACTIVE)).toBe(true);
    expect(isManualExtra(MANUAL_STAPLE)).toBe(true);
  });

  it('treats a legacy null origin as a manual add', () => {
    // Manual adds written before the Active/Staples split, plus the capture
    // sheet, store originId: null. They must not lose their protection.
    expect(isManualExtra(null)).toBe(true);
    expect(isManualExtra(undefined)).toBe(true);
  });

  it('does not claim automatic origins as manual', () => {
    expect(isManualExtra(PLAN_WIZARD)).toBe(false);
    expect(isManualExtra('pantry:running-low')).toBe(false);
    // Pipeline "add to shopping list" stores the idea's own id.
    expect(isManualExtra('idea_abc123')).toBe(false);
  });

  it('counts manual and wizard rows as deliberate (never Already-have)', () => {
    // Deliberate rows stay in the buy count / Instacart text even when the name
    // is pinned always-have or flagged a pantry staple.
    expect(isDeliberateExtra(MANUAL_ACTIVE)).toBe(true);
    expect(isDeliberateExtra(MANUAL_STAPLE)).toBe(true);
    expect(isDeliberateExtra(null)).toBe(true);
    expect(isDeliberateExtra(PLAN_WIZARD)).toBe(true);
  });

  it('leaves auto-surfaced rows to the ordinary have/staple routing', () => {
    expect(isDeliberateExtra('pantry:running-low')).toBe(false);
    expect(isDeliberateExtra('idea_abc123')).toBe(false);
  });

  it('keeps the two manual origins distinct so a row picks ONE list', () => {
    // Active vs Staples is now recorded on the extra, not inferred from the
    // always-have pin — that inference is what let rows drift between views.
    expect(MANUAL_ACTIVE).not.toBe(MANUAL_STAPLE);
  });
});
