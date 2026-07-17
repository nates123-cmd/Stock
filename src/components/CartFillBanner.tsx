import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { colors } from '@/design';
import { jobStatus } from '@/lib/instacart';
import { useCartFillStore } from '@/store/cartFill';

/**
 * Floating cart-fill status banner. Mounted once in the tab layout so it shows
 * over EVERY tab: push a list to Wegmans/Costco, then keep using the app while a
 * progress bar tracks the ~30s fill. Tap it to jump back to the shopping list;
 * ✕ dismisses. Auto-clears a few seconds after it finishes.
 *
 * Progress is time-based (the agent doesn't emit per-item progress): it eases
 * toward ~90% over the typical fill time, then snaps to 100% on done.
 */
const EST_FILL_MS = 35_000;

export function CartFillBanner({ bottomOffset = 12 }: { bottomOffset?: number }) {
  const router = useRouter();
  const jobId = useCartFillStore((s) => s.jobId);
  const status = useCartFillStore((s) => s.status);
  const retailer = useCartFillStore((s) => s.retailer);
  const total = useCartFillStore((s) => s.total);
  const added = useCartFillStore((s) => s.added);
  const startedAtMs = useCartFillStore((s) => s.startedAtMs);
  const update = useCartFillStore((s) => s.update);
  const clear = useCartFillStore((s) => s.clear);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const active = status === 'queued' || status === 'running';

  // Poll the job while it's in flight.
  useEffect(() => {
    if (!jobId || !active) return;
    let alive = true;
    const poll = async () => {
      const s = await jobStatus(jobId);
      if (!alive || !s) return;
      if (s.status === 'done') {
        const r = s.result as { added?: unknown[] } | null;
        update({ status: 'done', added: Array.isArray(r?.added) ? r!.added!.length : null });
      } else if (s.status === 'error') {
        update({ status: 'error' });
      } else if (s.status !== status) {
        update({ status: s.status as 'queued' | 'running' });
      }
    };
    const iv = setInterval(poll, 4000);
    void poll();
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [jobId, active, status, update]);

  // Tick the progress bar while active.
  useEffect(() => {
    if (!jobId || !active) return;
    const iv = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(iv);
  }, [jobId, active]);

  // Auto-dismiss after it settles.
  useEffect(() => {
    if (status !== 'done' && status !== 'error') return;
    const t = setTimeout(() => clear(), 9000);
    return () => clearTimeout(t);
  }, [status, clear]);

  if (!jobId || !status) return null;

  const store = retailer === 'costco' ? 'Costco' : 'Wegmans';
  const frac =
    active && startedAtMs ? Math.min(0.9, (nowMs - startedAtMs) / EST_FILL_MS) : 1;
  const label =
    status === 'error'
      ? `${store} cart fill hit a problem`
      : status === 'done'
        ? `${store} cart filled${added != null ? ` · ${added} added` : ''}`
        : `Filling ${store} cart… ${total} item${total === 1 ? '' : 's'}`;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/', params: { segment: 'shop' } })}
      style={[styles.wrap, { bottom: bottomOffset }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to open the shopping list.`}>
      <View style={styles.row}>
        <Text variant="bodyStrong" color="bg" numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        <Pressable
          onPress={() => clear()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss">
          <Text variant="bodyStrong" color="bg">
            ✕
          </Text>
        </Pressable>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.round(frac * 100)}%` },
            status === 'error' && styles.fillError,
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: colors.accentDeep,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    // Sit above content; the tab bar renders below this.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { flex: 1, minWidth: 0 },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.bg },
  fillError: { backgroundColor: colors.warn },
});

export default CartFillBanner;
