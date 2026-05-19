import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, layout } from '@/design';

/**
 * Sheet-up / scrub overlay primitive (spec §2 "Sheet-up overlays", §7). Dim
 * backdrop dismisses on tap; a grab handle signals draggability. (Pan-to-
 * dismiss uses gesture-handler — deferred; tap-backdrop covers v1.)
 */
export function Overlay({
  visible,
  onClose,
  children,
  anchor = 'bottom',
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  anchor?: 'bottom' | 'center';
}) {
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.panelWrap, anchor === 'center' && styles.center]}>
        <View style={[styles.panel, anchor === 'center' && styles.panelCenter]}>
          <View style={styles.handle} />
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(61,43,31,0.45)' },
  panelWrap: { flex: 1, justifyContent: 'flex-end' },
  center: { justifyContent: 'center', paddingHorizontal: layout.screenPadding },
  panel: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 28,
    paddingTop: 10,
    maxHeight: '80%',
  },
  panelCenter: { borderRadius: 20, maxHeight: '70%' },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 14,
  },
});

export default Overlay;
