/**
 * Cook Plan scheduling — pure helpers (kept side-effect-free so they're unit
 * testable). When a plan has a serve time, each phase's `offsetFromServe`
 * (hours-before-serve window) back-computes a wall-clock window:
 *   earliest start = serve − maxHours,  latest start = serve − minHours.
 */
import type { CookPlan, PlanPhase } from '@/types';

export type PhaseWindow = {
  phaseId: string;
  label: string;
  /** window opens (earliest you'd start) */
  from?: Date;
  /** window closes (latest you'd start to still land on time) */
  to?: Date;
};

export function phaseWindow(phase: PlanPhase, serveAt?: Date): PhaseWindow {
  if (!serveAt || !phase.offsetFromServe) {
    return { phaseId: phase.id, label: phase.label };
  }
  const { minHours, maxHours } = phase.offsetFromServe;
  const ms = 3_600_000;
  return {
    phaseId: phase.id,
    label: phase.label,
    from: new Date(serveAt.getTime() - maxHours * ms),
    to: new Date(serveAt.getTime() - minHours * ms),
  };
}

export function phaseWindows(plan: CookPlan): PhaseWindow[] {
  return plan.phases.map((p) => phaseWindow(p, plan.serveAt));
}

/** "Sat 7:00 AM" — compact wall-clock for a window edge. */
export function fmtWindowTime(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Human window label: "Sat 7:00 AM – 11:00 AM", or "" when unscheduled. */
export function fmtWindow(w: PhaseWindow): string {
  if (!w.from || !w.to) return '';
  const from = fmtWindowTime(w.from);
  const to = w.to.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
  return from === to ? from : `${from} – ${to}`;
}

/** Count of steps across a plan (for the at-a-glance meta line). */
export function totalSteps(plan: CookPlan): number {
  return plan.phases.reduce((n, p) => n + p.steps.length, 0);
}
