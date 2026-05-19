import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, layout } from '@/design';

export type ScreenProps = {
  children: ReactNode;
  /** Wrap content in a ScrollView. Default true. */
  scroll?: boolean;
  /** Apply standard horizontal screen padding (spec §2). Default true. */
  padded?: boolean;
  edges?: readonly Edge[];
  contentStyle?: ViewStyle;
};

/**
 * Standard screen container: parchment background, safe-area aware, standard
 * horizontal padding (spec §2 "Layout grammar"). Bottom-pinned action bars are
 * composed by individual screens outside this wrapper's scroll area.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['top'],
  contentStyle,
}: ScreenProps) {
  const inner = (
    <View
      style={[
        padded && { paddingHorizontal: layout.screenPadding },
        { flexGrow: 1 },
        contentStyle,
      ]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
});

export default Screen;
