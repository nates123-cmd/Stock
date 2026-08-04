import { StyleSheet, View } from 'react-native';
import { colors, layout } from '@/design';
import { Button } from './Button';
import { Overlay } from './Overlay';
import { Text } from './Text';

/**
 * "Push to a cart" — pick where the selected items go.
 *
 * Three destinations, and they are genuinely different operations, so the sheet
 * says which is which rather than pretending they're interchangeable:
 *
 *  - Wegmans  — the Beelink agent fills the Instacart cart. Takes a minute.
 *  - Walmart  — a keyless link opens the cart already filled. Instant.
 *  - Compare  — fills a real cart at SEVERAL stores, then reports what each
 *               costs. Slowest, and it leaves carts behind at every store.
 *
 * Compare is last and labelled with its cost on purpose: it's the most useful
 * and the most invasive, and picking it by accident means five stores now have
 * groceries in them.
 */
export type CartTarget = 'wegmans' | 'walmart' | 'compare';

export function PushToCartSheet({
  visible,
  onClose,
  count,
  onPick,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  /** How many rows are selected — every label says it, so nothing is a surprise. */
  count: number;
  onPick: (target: CartTarget) => void;
  busy?: boolean;
}) {
  return (
    <Overlay visible={visible} onClose={onClose}>
      <Text variant="recipeTitle">Push to a cart</Text>
      <Text variant="body" color="textMuted" style={styles.sub}>
        {count} item{count === 1 ? '' : 's'} selected
      </Text>

      <View style={styles.option}>
        <Button
          label={`Wegmans · ${count}`}
          glyph="next"
          disabled={busy}
          onPress={() => onPick('wegmans')}
        />
        <Text variant="body" color="textMuted" style={styles.hint}>
          Fills your Wegmans cart on Instacart. Takes about a minute.
        </Text>
      </View>

      <View style={styles.option}>
        <Button
          label={`Walmart · ${count}`}
          variant="secondary"
          disabled={busy}
          onPress={() => onPick('walmart')}
        />
        <Text variant="body" color="textMuted" style={styles.hint}>
          Opens your Walmart cart already filled, set for delivery.
        </Text>
      </View>

      <View style={[styles.option, styles.last]}>
        <Button
          label={`Compare stores · ${count}`}
          variant="secondary"
          disabled={busy}
          onPress={() => onPick('compare')}
        />
        <Text variant="body" color="textMuted" style={styles.hint}>
          Builds a real cart at Wegmans, Food Bazaar, ShopRite, Key Food and
          Stop &amp; Shop, then tells you what each costs and what's missing.
          Slow, and it leaves a cart at every store — you can clear the ones you
          don't want afterwards.
        </Text>
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  sub: { marginTop: 2, marginBottom: 16 },
  option: {
    gap: 6,
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  last: { borderBottomWidth: 0, marginBottom: layout.cardGap },
  hint: { lineHeight: 18 },
});
