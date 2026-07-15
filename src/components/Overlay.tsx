import { useEffect, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { colors, layout } from '@/design';
import { Glyph } from './Glyph';

/**
 * Sheet-up / scrub overlay primitive (spec §2 "Sheet-up overlays", §7).
 * Three dismissal paths, all wired (spec §6 scaler exit):
 * - tap-backdrop (the dim area outside the panel)
 * - Escape key on web
 * - visible ✕ close button in the panel top-right
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
  // ESC key dismiss on web. Listener is attached only while visible and
  // torn down on close/unmount — no risk of leaking handlers.
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [visible, onClose]);

  if (!visible) return null;
  // Render through a Modal so the sheet is anchored to the SCREEN, not to
  // whatever it happens to be nested under. It used to be a bare absoluteFill,
  // which positions relative to the nearest positioned ancestor — fine when the
  // overlay sat at the screen root, but when it lives inside a ScrollView (e.g.
  // the cook screen's bench tools) absoluteFill anchors to the scroll CONTENT,
  // so on a tall recipe the sheet overlapped the page and its panel scrolled
  // out of reach. `transparent` keeps our own dim backdrop.
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      // web: react-native-web portals this to the document root.
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close overlay"
          accessibilityRole="button"
        />
        <View
          style={[styles.panelWrap, anchor === 'center' && styles.center]}
          // The wrapper's empty area (above the bottom-anchored panel) must
          // pass touches through to the backdrop, or the dismiss tap is dead
          // on web above the panel. Root cause of "can't exit the scaler".
          pointerEvents="box-none">
          <View style={[styles.panel, anchor === 'center' && styles.panelCenter]}>
            <View style={styles.handle} />
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={12}
              accessibilityLabel="Close"
              accessibilityRole="button">
              <Glyph name="close" size={18} color="textMuted" />
            </Pressable>
            {children}
          </View>
        </View>
      </View>
    </Modal>
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
  closeBtn: {
    position: 'absolute',
    top: 8,
    right: 12,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
});

export default Overlay;
