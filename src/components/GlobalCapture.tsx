import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { Glyph } from './Glyph';
import { CaptureSheet } from './CaptureSheet';
import { colors } from '@/design';

// The Plan tab (path '/') is the only tab that pins a BottomActionBar — its
// Shop segment shows the Send-to-cart bar, its Plan segment the Shopping-list
// bar. The FAB used to land right on top of it, so on that tab (and only that
// tab) we lift the FAB by the action bar's height so it floats clear above it.
// Sized to clear the tallest case (meta line + button row + padding); other
// tabs carry no bar, so they keep the original resting height.
const ACTION_BAR_CLEARANCE = 96;

/**
 * Global quick-capture control — mounted once in (tabs)/_layout OUTSIDE <Tabs>,
 * so a single floating FAB floats over every tab. Tapping opens the shared
 * CaptureSheet (defaults to Shopping). It's a bespoke floating button rather
 * than the library <Fab> because it must sit ABOVE the tab bar (56 + inset),
 * whereas <Fab> is pinned to bottom:24.
 */
export function GlobalCapture() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Match the tab bar geometry in _layout: height = 56 + max(inset, 40).
  const barHeight = 56 + Math.max(insets.bottom, 40);
  const onPlanTab = pathname === '/';
  const bottom = barHeight + 16 + (onPlanTab ? ACTION_BAR_CLEARANCE : 0);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quick capture"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.fab,
          { bottom },
          pressed && styles.pressed,
        ]}>
        {/* TODO(visual): cart glyph — no clean monochrome cart exists under the
            no-emoji rule; using `add` until the deferred visual session. */}
        <Glyph name="add" size={26} color="bg" />
      </Pressable>

      <CaptureSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.text,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  pressed: { opacity: 0.7 },
});

export default GlobalCapture;
