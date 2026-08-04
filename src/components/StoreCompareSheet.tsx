import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, layout } from '@/design';
import { Button } from './Button';
import { Overlay } from './Overlay';
import { Text } from './Text';
import { compareQuotes, describeSlot, type QuoteRetailer, type StoreQuote } from '@/lib/quotes';
import { quoteAllStores, type QuoteInput } from '@/lib/storeQuotes';

/**
 * "Where should I order this from?" — the same list priced at every store we
 * can quote, with the gaps called out.
 *
 * The verdict lines come first on purpose. The table is there to check the
 * work, but the answer Nate wants is a sentence: who's missing what, who's
 * cheaper, who's slower. Reading a grid to find that out is the thing this is
 * supposed to replace.
 *
 * Estimates only — see storeQuotes.ts. The footer says so rather than letting
 * a snapshot price read as a quote.
 */
export function StoreCompareSheet({
  visible,
  onClose,
  items,
  onPush,
  busy,
  liveQuotes,
  onScan,
  scanState = 'idle',
  scanError,
}: {
  visible: boolean;
  onClose: () => void;
  /** The selected shopping rows, already de-duplicated by the caller. */
  items: QuoteInput[];
  /** Send the list to this store. The sheet doesn't know how each one works. */
  onPush: (retailer: QuoteRetailer) => void;
  busy?: boolean;
  /** Results of a live Instacart scan, merged in alongside the bundled ones. */
  liveQuotes?: StoreQuote[];
  onScan?: () => void;
  scanState?: 'idle' | 'running' | 'error';
  scanError?: string;
}) {
  const { comparison, quotes } = useMemo(() => {
    // Bundled catalogs answer instantly; a live scan adds the Instacart
    // storefronts. A live quote WINS over a bundled one for the same store —
    // it was read minutes ago, the catalog possibly weeks ago.
    const bundled = quoteAllStores(items);
    const live = liveQuotes ?? [];
    const liveSlugs = new Set(live.map((q) => q.retailer));
    const qs = [...bundled.filter((q) => !liveSlugs.has(q.retailer)), ...live];
    return { comparison: compareQuotes(qs), quotes: qs };
  }, [items, liveQuotes]);

  const noteFor = (r: QuoteRetailer) => quotes.find((q) => q.retailer === r)?.note;

  return (
    <Overlay visible={visible} onClose={onClose}>
      <Text variant="recipeTitle">Compare stores</Text>
      <Text variant="body" color="textMuted" style={styles.sub}>
        {items.length} item{items.length === 1 ? '' : 's'}
      </Text>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {comparison.verdicts.length ? (
          <View style={styles.verdicts}>
            {comparison.verdicts.map((v) => (
              <Text key={v} variant="body" style={styles.verdict}>
                {v}
              </Text>
            ))}
          </View>
        ) : (
          <Text variant="body" color="textMuted" style={styles.verdict}>
            These stores carry everything on this list at about the same price.
          </Text>
        )}

        {onScan ? (
          <View style={styles.scanRow}>
            <Button
              label={
                scanState === 'running'
                  ? 'Checking storefronts…'
                  : liveQuotes?.length
                    ? 'Re-check live prices'
                    : 'Check live prices at more stores'
              }
              variant="secondary"
              flex
              disabled={scanState === 'running' || !items.length}
              onPress={onScan}
            />
          </View>
        ) : null}
        {scanState === 'running' ? (
          <Text variant="body" color="textMuted" style={styles.note}>
            Reading Food Bazaar, ShopRite, Key Food and Stop &amp; Shop on Instacart. Takes a minute or two.
          </Text>
        ) : null}
        {scanState === 'error' && scanError ? (
          <Text variant="body" color="accent" style={styles.note}>
            {scanError}
          </Text>
        ) : null}

        {comparison.stores.map((s) => {
          const slot = describeSlot(s.earliestDelivery);
          const recommended = comparison.recommended === s.retailer;
          return (
            <View
              key={s.retailer}
              style={[styles.card, recommended && styles.cardBest]}>
              <View style={styles.cardHead}>
                <Text variant="bodyStrong">{s.label}</Text>
                {recommended ? (
                  <Text variant="sectionLabel" color="ok">
                    Best pick
                  </Text>
                ) : null}
              </View>

              <Text variant="body" color="textMuted">
                {s.have + s.substitutes} of {s.total} items
                {s.subtotal > 0 ? ` · about $${s.subtotal.toFixed(2)}` : ''}
                {s.etaText ? ` · ${s.etaText.toLowerCase()}` : slot ? ` · ${slot}` : ''}
                {s.distanceMi ? ` · ${s.distanceMi} mi` : ''}
              </Text>

              {s.missing.length ? (
                <Text variant="body" color="accent" style={styles.missing}>
                  No {s.missing.join(', ')}
                </Text>
              ) : null}

              {s.unknown.length ? (
                <Text variant="body" color="textMuted" style={styles.missing}>
                  Couldn't check {s.unknown.join(', ')}
                </Text>
              ) : null}

              {noteFor(s.retailer) ? (
                <Text variant="body" color="textMuted" style={styles.note}>
                  {noteFor(s.retailer)}
                </Text>
              ) : null}

              <Button
                label={
                  s.retailer === 'walmart'
                    ? `Open Walmart cart · ${s.have + s.substitutes}`
                    : `Push to ${s.label} · ${s.have + s.substitutes}`
                }
                variant={recommended ? 'primary' : 'secondary'}
                disabled={busy || s.have + s.substitutes === 0}
                onPress={() => onPush(s.retailer)}
                style={styles.cta}
              />
            </View>
          );
        })}

        <Text variant="body" color="textMuted" style={styles.disclaimer}>
          Prices are from the last catalog refresh — good enough to pick a store,
          not a quote. Each store's own cart shows the real total before you check
          out.
        </Text>
      </ScrollView>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  sub: { marginTop: 2, marginBottom: 10 },
  scroll: { marginBottom: 4 },
  verdicts: { marginBottom: 14, gap: 6 },
  verdict: { lineHeight: 20 },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: layout.cardRadius,
    padding: 14,
    marginBottom: layout.cardGap,
    gap: 4,
  },
  cardBest: { borderColor: colors.ok },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  missing: { marginTop: 2 },
  note: { marginTop: 2 },
  cta: { marginTop: 10 },
  scanRow: { marginBottom: 12 },
  disclaimer: { marginTop: 2, marginBottom: 8, lineHeight: 18 },
});
