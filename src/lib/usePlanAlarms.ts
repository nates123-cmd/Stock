import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { uid } from './id';

/**
 * Live cook-mode alarms for Cook Plans (the killer feature). One interval ticks
 * all running countdowns; when one hits zero it fires an OS notification (web
 * PWA) plus a short beep so a backgrounded/peripheral phone still gets the cue.
 *
 * Honesty note: a browser only reliably fires while the page is alive (open in
 * a tab, even backgrounded). True closed-app delivery needs the Notification
 * Triggers API / a push backend, which isn't broadly available — so a long
 * brine clock is best-effort if the tab is fully closed. Durations during an
 * active cook (the page is open) are solid.
 */
const WEB = Platform.OS === 'web';

export type PlanAlarm = {
  id: string;
  label: string;
  total: number; // seconds
  remaining: number;
  /** clock-kind window: keep showing "window open" until this elapses */
  windowSeconds?: number;
  done: boolean;
  fired: boolean;
  stepId?: string;
};

/** Ask for notification permission up front (no-op off-web / unsupported). */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!WEB || typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

export function notifyEnabled(): boolean {
  return WEB && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function fireNotification(title: string, body: string): void {
  try {
    if (WEB && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'stock-cook-plan' });
    }
  } catch {
    /* notifications best-effort */
  }
  // Short beep via WebAudio so a glance-down phone still gets a cue.
  try {
    const AC =
      typeof window !== 'undefined'
        ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (AC) {
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => void ctx.close();
    }
  } catch {
    /* audio best-effort */
  }
}

export function usePlanAlarms(planTitle: string) {
  const [alarms, setAlarms] = useState<PlanAlarm[]>([]);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const titleRef = useRef(planTitle);
  titleRef.current = planTitle;

  useEffect(() => {
    ref.current = setInterval(() => {
      setAlarms((prev) => {
        if (prev.length === 0) return prev;
        let changed = false;
        const next = prev.map((a) => {
          if (a.done || a.remaining <= 0) return a;
          changed = true;
          const remaining = a.remaining - 1;
          const done = remaining <= 0;
          if (done && !a.fired) {
            fireNotification(
              titleRef.current,
              `${a.label} — done`,
            );
            return { ...a, remaining, done: true, fired: true };
          }
          return { ...a, remaining, done };
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, []);

  const startAlarm = (
    label: string,
    seconds: number,
    opts?: { windowSeconds?: number; stepId?: string },
  ) =>
    setAlarms((prev) => [
      ...prev,
      {
        id: uid('alarm'),
        label,
        total: seconds,
        remaining: seconds,
        windowSeconds: opts?.windowSeconds,
        done: false,
        fired: false,
        stepId: opts?.stepId,
      },
    ]);

  const clearAlarm = (id: string) =>
    setAlarms((prev) => prev.filter((a) => a.id !== id));

  return { alarms, startAlarm, clearAlarm };
}
