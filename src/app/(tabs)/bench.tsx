import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Heading, SectionLabel, Screen, BenchPanel, type BenchTab } from '@/components';

/**
 * Bench (workbench) — Convert recipe amounts to grams + baker's %, and look
 * up ranked ingredient substitutes (spec §9, §11.4–5).
 *
 * Redesign Phase C: Bench folded into the Cook surface and is no longer a
 * visible tab. This route stays as a hidden fallback (deep links / direct
 * nav); the live entry points are the Cook launcher's "Open Bench" sheet and
 * the recipe-detail deep links, which now open the in-Cook BenchSheet. The
 * tool logic lives in the shared <BenchPanel> (src/components/BenchTools).
 */
export default function BenchScreen() {
  const params = useLocalSearchParams<{
    tab?: BenchTab;
    text?: string;
    sub?: string;
    amount?: string;
    unit?: string;
  }>();

  return (
    <Screen>
      <View style={styles.header}>
        <Heading variant="wordmark">Stock</Heading>
        <SectionLabel>Workbench</SectionLabel>
      </View>

      <BenchPanel
        initialTab={params.tab}
        initialText={params.text ?? ''}
        initialSub={params.sub ?? ''}
        initialAmount={params.amount ?? ''}
        initialUnit={params.unit ?? 'cup'}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
  },
});
