import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, Heading, Numeric, SectionLabel } from './Text';
import { Button } from './Button';
import { Overlay } from './Overlay';
import { colors } from '@/design';
import { formatAmount } from '@/lib/format';
import { suggestSubstitutes, type Substitute } from '@/lib/substitutions';

/** What accepting a substitution hands back. */
export type AppliedSub = {
  name: string;
  amount: number | null;
  unit: string | null;
  /** the swap's note, for the modification record / row detail */
  note: string;
};

/**
 * Sub — long-press an ingredient (in a recipe) or a row (on the shopping list),
 * get three ranked swaps with real amounts, and turn the item into one.
 *
 * The suggestion half is Claude-first with a curated offline table behind it
 * (lib/substitutions). The *accept* half is what makes this more than the Bench
 * tool that already existed: Bench told you the answer and left you to retype
 * it, which is the wrong job for something you reach for with one hand while
 * the pan is hot.
 */
export function SubSheet({
  visible,
  name,
  amount,
  unit,
  onClose,
  onApply,
}: {
  visible: boolean;
  name: string;
  amount: number | null;
  unit: string | null;
  onClose: () => void;
  onApply: (sub: AppliedSub) => void;
}) {
  const [subs, setSubs] = useState<Substitute[] | null>(null);
  const [source, setSource] = useState<'claude' | 'local'>('local');
  const [busy, setBusy] = useState(false);

  // Look them up as soon as the sheet opens — one long-press should be the
  // whole interaction, not a press and then a "Find" button.
  useEffect(() => {
    if (!visible) {
      setSubs(null);
      return;
    }
    let live = true;
    setBusy(true);
    void suggestSubstitutes(name, {
      value: amount != null && amount > 0 ? amount : 1,
      unit: unit || 'cup',
    })
      .then((res) => {
        if (!live) return;
        setSubs(res.subs);
        setSource(res.source);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [visible, name, amount, unit]);

  const original = formatAmount(amount, unit ?? null);

  return (
    <Overlay visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Heading variant="recipeTitle">Sub</Heading>
          <Text color="textMuted" numberOfLines={1}>
            {original ? `${original} ` : ''}
            {name}
          </Text>
        </View>

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
            <Text color="textFaint">Finding substitutes…</Text>
          </View>
        ) : null}

        {!busy && subs && subs.length === 0 ? (
          <Text color="textFaint" style={styles.empty}>
            No substitution for this one. Claude is unavailable and it is not in
            the offline list.
          </Text>
        ) : null}

        {!busy && subs && subs.length > 0 ? (
          <>
            <SectionLabel color="textMuted">
              {source === 'local' ? 'Offline suggestions' : 'Best swaps'}
            </SectionLabel>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {subs.map((s) => (
                <Pressable
                  key={s.rank}
                  style={styles.card}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${s.name}`}
                  onPress={() =>
                    onApply({
                      name: s.name,
                      amount: s.amount.value,
                      unit: s.amount.unit,
                      note: s.note,
                    })
                  }>
                  <View style={styles.rank}>
                    <Numeric color="bg" style={styles.rankNum}>
                      {s.rank}
                    </Numeric>
                  </View>
                  <View style={styles.cardText}>
                    <Text variant="bodyStrong">{s.name}</Text>
                    <Numeric color="accent">
                      {formatAmount(s.amount.value, s.amount.unit)}
                    </Numeric>
                    <Text color="textFaint" style={styles.note}>
                      {s.note}
                    </Text>
                  </View>
                  <Text color="accent" variant="bodyStrong">
                    Use
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        <Button label="Cancel" variant="secondary" onPress={onClose} />
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 12, paddingBottom: 8 },
  head: { gap: 2 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 22 },
  empty: { paddingVertical: 18, lineHeight: 20 },
  list: { maxHeight: 340 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    marginTop: 2,
  },
  rankNum: { fontSize: 12 },
  cardText: { flex: 1, gap: 2 },
  note: { lineHeight: 18 },
});
