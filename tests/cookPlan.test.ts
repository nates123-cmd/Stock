import { describe, it, expect } from 'vitest';
import {
  localParseCookPlan,
  detectTimer,
  parseIngredientBullet,
} from '@/lib/parsing/cookPlan';
import { seedCookPlans } from '@/lib/seedCookPlans';
import { phaseWindow, totalSteps } from '@/lib/planSchedule';

describe('detectTimer', () => {
  it('reads a fry-oil temperature range', () => {
    const t = detectTimer('Heat fry oil to 325-335 for the first fry.');
    expect(t?.kind).toBe('temp');
    expect(t?.tempF).toBe(325);
    expect(t?.tempHighF).toBe(335);
  });

  it('reads a single temperature', () => {
    const t = detectTimer('Heat oil to 375 for the second fry.');
    expect(t?.kind).toBe('temp');
    expect(t?.tempF).toBe(375);
  });

  it('reads a "200 degree oven" temperature', () => {
    const t = detectTimer('Hold finished pieces in a 200 degree oven.');
    expect(t?.kind).toBe('temp');
    expect(t?.tempF).toBe(200);
  });

  it('reads a long clock window (8-12 hour brine)', () => {
    const t = detectTimer('Starts the 8-12 hour clock, lands right for a night cook');
    expect(t?.kind).toBe('clock');
    expect(t?.minSeconds).toBe(8 * 3600);
    expect(t?.maxSeconds).toBe(12 * 3600);
  });

  it('reads a single duration', () => {
    const t = detectTimer('rest for 12 minutes');
    expect(t?.kind).toBe('duration');
    expect(t?.seconds).toBe(12 * 60);
  });

  it('returns nothing for timer-free text', () => {
    expect(detectTimer('Serve immediately.')).toBeUndefined();
  });
});

describe('parseIngredientBullet', () => {
  it('parses "Name: 40 g" form', () => {
    const ing = parseIngredientBullet('* Kosher salt: 40 g');
    expect(ing.canonicalName).toBe('kosher salt');
    expect(ing.amount).toBe(40);
    expect(ing.unit).toBe('g');
  });

  it('parses "1 cup name" form', () => {
    const ing = parseIngredientBullet('* 1 cup vegetable oil, heated until shimmering');
    expect(ing.amount).toBe(1);
    expect(ing.unit).toBe('cup');
    expect(ing.canonicalName).toContain('vegetable oil');
  });

  it('keeps bare ingredients (no amount)', () => {
    const ing = parseIngredientBullet('* Salt');
    expect(ing.canonicalName).toBe('salt');
    expect(ing.amount).toBeNull();
  });
});

describe('localParseCookPlan (the Friday fried-chicken plan)', () => {
  const plan = seedCookPlans()[0]!;

  it('extracts the title', () => {
    expect(plan.title.toLowerCase()).toContain('fried chicken');
  });

  it('finds the three timeline phases', () => {
    const labels = plan.phases.map((p) => p.label.toLowerCase());
    expect(labels.some((l) => l.includes('tonight'))).toBe(true);
    expect(labels.some((l) => l.includes('tomorrow am'))).toBe(true);
    expect(labels.some((l) => l.includes('tomorrow night'))).toBe(true);
  });

  it('captures the component sub-recipes with ingredients', () => {
    const names = plan.components.map((c) => c.name.toLowerCase());
    expect(names.some((n) => n.includes('ginger-scallion'))).toBe(true);
    expect(names.some((n) => n.includes('slaw'))).toBe(true);
    const brine = plan.components.find((c) => /brine/i.test(c.name));
    expect(brine && brine.ingredients.length).toBeGreaterThan(3);
  });

  it('parses the 9-step cook sequence', () => {
    const cook = plan.phases.find((p) => /tomorrow night/i.test(p.label))!;
    expect(cook.steps.length).toBe(9);
  });

  it('attaches a temp timer to the fry-oil step', () => {
    const cook = plan.phases.find((p) => /tomorrow night/i.test(p.label))!;
    const fry = cook.steps.find((s) => /325-335/.test(s.text));
    expect(fry?.timer?.kind).toBe('temp');
    expect(fry?.timer?.tempF).toBe(325);
  });

  it('hoists the brine clock onto the dry-brine step', () => {
    const am = plan.phases.find((p) => /tomorrow am/i.test(p.label))!;
    const brineStep = am.steps.find((s) => /brine/i.test(s.text));
    expect(brineStep?.timer?.kind).toBe('clock');
    expect(brineStep?.timer?.minSeconds).toBe(8 * 3600);
  });

  it('detects the baker\'s-% anchor on the slaw dressing', () => {
    const slaw = plan.components.find((c) => /slaw/i.test(c.name))!;
    expect(slaw.bakersPercent).toBeTruthy();
    expect(slaw.bakersPercent?.anchorIngredientId).toBeTruthy();
    const anchor = slaw.ingredients.find(
      (i) => i.id === slaw.bakersPercent?.anchorIngredientId,
    );
    expect(anchor?.canonicalName).toContain('vinegar');
  });

  it('captures the full spread', () => {
    expect(plan.spread.length).toBeGreaterThanOrEqual(8);
    expect(plan.spread.join(' ').toLowerCase()).toContain('kimchi');
  });

  it('totals all steps across phases', () => {
    expect(totalSteps(plan)).toBe(
      plan.phases.reduce((n, p) => n + p.steps.length, 0),
    );
  });
});

describe('phaseWindow scheduling', () => {
  it('back-computes a wall-clock window from serve time', () => {
    const serveAt = new Date('2026-07-04T19:00:00');
    const phase = {
      id: 'p1',
      label: 'Tomorrow AM',
      steps: [],
      offsetFromServe: { minHours: 8, maxHours: 12 },
    };
    const w = phaseWindow(phase, serveAt);
    // window opens serve-12h (7am), closes serve-8h (11am)
    expect(w.from?.getHours()).toBe(7);
    expect(w.to?.getHours()).toBe(11);
  });

  it('returns a bare window when unscheduled', () => {
    const w = phaseWindow(
      { id: 'p', label: 'X', steps: [], offsetFromServe: { minHours: 1, maxHours: 2 } },
      undefined,
    );
    expect(w.from).toBeUndefined();
    expect(w.to).toBeUndefined();
  });
});
