import { useEffect, useRef, useState } from 'react';
import { uid } from './id';

export type CookTimer = {
  id: string;
  label: string;
  total: number; // seconds
  remaining: number;
  stepOrdinal: number; // provenance — which step started it
  done: boolean;
};

/**
 * Cook-session timers (spec §7 "Active timers strip"). One interval ticks all
 * running timers; they persist across step navigation because they live in the
 * cook screen, not per-step. A live countdown is functional, not decorative
 * motion — the no-setInterval-on-home-surfaces preference does not apply here.
 */
export function useCookTimers() {
  const [timers, setTimers] = useState<CookTimer[]>([]);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ref.current = setInterval(() => {
      setTimers((prev) => {
        if (prev.length === 0) return prev;
        let changed = false;
        const next = prev.map((t) => {
          if (t.done || t.remaining <= 0) return t;
          changed = true;
          const remaining = t.remaining - 1;
          return { ...t, remaining, done: remaining <= 0 };
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, []);

  const startTimer = (label: string, total: number, stepOrdinal: number) =>
    setTimers((prev) => [
      ...prev,
      { id: uid('tmr'), label, total, remaining: total, stepOrdinal, done: false },
    ]);

  const clearTimer = (id: string) =>
    setTimers((prev) => prev.filter((t) => t.id !== id));

  return { timers, startTimer, clearTimer };
}

/** Seconds → "9:05" / "1:09:05". */
export function fmtClock(s: number): string {
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}
