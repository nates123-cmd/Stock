import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/design';

/**
 * Bottom-pinned action bar (spec §2 "Layout grammar", used across capture /
 * detail / plan). Buttons sit in a row; optional meta line above them.
 */
export function BottomActionBar({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {meta ? <View style={styles.meta}>{meta}</View> : null}
      <View style={styles.row}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  meta: { paddingBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
});

export default BottomActionBar;
