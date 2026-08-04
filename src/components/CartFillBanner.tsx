import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { colors } from '@/design';
import { jobStatus } from '@/lib/instacart';
import { scanStatus } from '@/lib/storeScan';
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
/**
 * How long each kind of job typically takes, for the progress bar.
 *
 * These differ by an order of magnitude — a Wegmans fill is ~35s, a Walmart
 * live resolve is ~6s PER ITEM, and a multi-store compare fills a cart at every
 * store. Using one constant made the bar sit at 90% for minutes, which reads as
 * "stuck".
 */
const EST_MS: Record<string, number> = {
  wegmans: 35_000,
  costco: 35_000,
  walmart: 8_000, // × items
  compare: 25_000, // × items
};
const PER_ITEM = new Set(['walmart', 'compare']);

export function CartFillBanner({ bottomOffset }: { bottomOffset?: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Mounted at the ROOT so it floats over every screen (tabs AND modals). Default
  // sits above where the tab bar would be; callers can override.
  const offset = bottomOffset ?? Math.max(insets.bottom, 40) + 52;
  const jobId = useCartFillStore((s) => s.jobId);
  const status = useCartFillStore((s) => s.status);
  const retailer = useCartFillStore((s) => s.retailer);
  const total = useCartFillStore((s) => s.total);
  const added = useCartFillStore((s) => s.added);
  const unavailable = useCartFillStore((s) => s.unavailable);
  const verified = useCartFillStore((s) => s.verified);
  const startedAtMs = useCartFillStore((s) => s.startedAtMs);
  const source = useCartFillStore((s) => s.source);
  const update = useCartFillStore((s) => s.update);
  const clear = useCartFillStore((s) => s.clear);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const active = status === 'queued' || status === 'running';

  // Poll the job while it's in flight.
  useEffect(() => {
    if (!jobId || !active) return;
    let alive = true;
    const poll = async () => {
      // Poll whichever queue this job actually lives in.
      const s = source === 'scan' ? await scanStatus(jobId) : await jobStatus(jobId);
      if (!alive || !s) return;
      if (s.status === 'done') {
        const r = s.result as
          | { added?: unknown[]; unavailable?: unknown[]; verified?: boolean }
          | null;
        update({
          status: 'done',
          added: Array.isArray(r?.added) ? r!.added!.length : null,
          unavailable: Array.isArray(r?.unavailable) ? r!.unavailable!.length : null,
          verified: r?.verified !== false, // undefined (old) = treat as verified
        });
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
  }, [jobId, active, status, update, source]);

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

  const STORE_NAME: Record<string, string> = {
    costco: 'Costco',
    wegmans: 'Wegmans',
    walmart: 'Walmart',
    compare: 'Compare',
  };
  const store = STORE_NAME[retailer] ?? 'Wegmans';
  const est = (EST_MS[retailer] ?? 35_000) * (PER_ITEM.has(retailer) ? Math.max(1, total) : 1);
  const frac = active && startedAtMs ? Math.min(0.9, (nowMs - startedAtMs) / est) : 1;

  // Walmart is a LOOKUP, not a fill — the cart only opens once it's resolved,
  // so saying "filling your cart" would be a lie for most of the wait.
  const working =
    retailer === 'walmart'
      ? `Looking up ${total} item${total === 1 ? '' : 's'} at Walmart…`
      : retailer === 'compare'
        ? `Building carts at ${total ? 'every store' : 'the stores'}…`
        : `Filling ${store} cart… ${total} item${total === 1 ? '' : 's'}`;

  const label =
    status === 'error'
      ? `${store} hit a problem`
      : status === 'done'
        ? retailer === 'walmart'
          ? 'Walmart items resolved — opening your cart'
          : retailer === 'compare'
            ? 'Carts built — open Compare to see them'
            : verified === false
              ? `${store} cart filled — couldn’t auto-confirm, check it`
              : `${store} cart filled${added != null ? ` · ${added} added` : ''}${
                  unavailable ? ` · ${unavailable} unavailable` : ''
                }`
        : working;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/', params: { segment: 'shop' } })}
      style={[styles.wrap, { bottom: offset }]}
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
    zIndex: 1000, // float over screen content + modals
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
