import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '@/design';
import { dropIndex, rowShift } from '@/lib/sortable';

/**
 * Drag-to-reorder list (the recipe editor's ingredients and steps).
 *
 * The drag lives on a GRIP at the start of each row, never on the row itself:
 * the rows are full of TextInputs, and a whole-row drag would fight both
 * typing and page scrolling. Same Pan pattern as the Plan tab's dishes
 * (plan.tsx DraggableDish): Reanimated moves the lifted row, JS works out
 * where it would land, and the rows in between slide aside to show the gap.
 *
 * Nothing is committed until you let go — `onReorder(from, to)` fires once.
 * The grip also exposes "Move up / Move down" accessibility actions, so the
 * order can be changed without a drag at all.
 *
 * Not handled: auto-scrolling when you drag past the edge of the screen. Drop
 * it at the edge, scroll, and drag again.
 */
export function SortableList<T extends { id: string }>({
  items,
  renderItem,
  onReorder,
  gap = 8,
}: {
  items: T[];
  /** `grip` must be rendered somewhere in the row — it is the drag handle. */
  renderItem: (item: T, index: number, grip: ReactNode) => ReactNode;
  onReorder: (from: number, to: number) => void;
  gap?: number;
}) {
  /**
   * Row HEIGHTS, keyed by item id; positions are derived from the current
   * order. Storing positions from onLayout does not work: on web onLayout
   * only fires when a row's SIZE changes, so after a reorder the stored y's
   * would describe the old order and the next drag would aim wrong.
   */
  const heights = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [drag, setDrag] = useState<{ from: number; to: number; h: number } | null>(null);
  // The live drag, written synchronously by start/move and read by end().
  // (Also keeps onReorder — a parent setState — out of a setDrag updater.)
  const dragRef = useRef<{ from: number; to: number; h: number } | null>(null);

  const onLayoutRow = (id: string) => (e: LayoutChangeEvent) => {
    heights.current.set(id, e.nativeEvent.layout.height);
  };

  /*
   * Safety net, web only: onLayout there rides on ResizeObserver, which does
   * not fire while the page isn't rendering (a hidden tab, a PWA resuming).
   * At drag start, read any height we still don't have straight off the DOM
   * node — on react-native-web a View ref IS the element.
   */
  const nodes = useRef(new Map<string, unknown>());
  const refRow = (id: string) => (node: unknown) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
  const fillHeights = () => {
    if (Platform.OS !== 'web') return;
    for (const it of itemsRef.current) {
      if (heights.current.get(it.id)) continue;
      const el = nodes.current.get(it.id) as { getBoundingClientRect?: () => DOMRect } | undefined;
      const h = el?.getBoundingClientRect?.().height;
      if (h) heights.current.set(it.id, h);
    }
  };

  const start = useCallback((from: number) => {
    fillHeights();
    const id = itemsRef.current[from]?.id;
    const h = (id ? heights.current.get(id) ?? 0 : 0) + gap;
    dragRef.current = { from, to: from, h };
    setDrag(dragRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap]);

  /** Where the dragged row's centre now sits → the index it would land at. */
  const move = useCallback((from: number, dy: number) => {
    const hs = itemsRef.current.map((it) => heights.current.get(it.id) ?? 0);
    const to = dropIndex(hs, gap, from, dy);
    // Write the ref NOW, not on the next render: a quick flick can release
    // before React re-renders, and end() must still see the latest target.
    const cur = dragRef.current;
    if (cur && cur.to !== to) {
      dragRef.current = { ...cur, to };
      setDrag(dragRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap]);

  const end = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d && d.to !== d.from) onReorder(d.from, d.to);
  }, [onReorder]);

  return (
    <View style={{ gap }}>
      {items.map((item, i) => {
        // Rows between the origin and the target slide one slot toward the gap.
        const shift = rowShift(i, drag && { from: drag.from, to: drag.to, slot: drag.h });
        return (
          <SortableRow
            key={item.id}
            index={i}
            count={items.length}
            shift={shift}
            dragging={drag?.from === i}
            onLayout={onLayoutRow(item.id)}
            rowRef={refRow(item.id)}
            onStart={start}
            onMove={move}
            onEnd={end}
            onStep={(dir) => {
              const to = i + dir;
              if (to >= 0 && to < items.length) onReorder(i, to);
            }}
            render={(grip) => renderItem(item, i, grip)}
          />
        );
      })}
    </View>
  );
}

function SortableRow({
  index,
  count,
  shift,
  dragging,
  onLayout,
  rowRef,
  onStart,
  onMove,
  onEnd,
  onStep,
  render,
}: {
  index: number;
  count: number;
  shift: number;
  dragging: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  rowRef: (node: unknown) => void;
  onStart: (from: number) => void;
  onMove: (from: number, dy: number) => void;
  onEnd: () => void;
  onStep: (dir: -1 | 1) => void;
  render: (grip: ReactNode) => ReactNode;
}) {
  const c = useColors();
  const dy = useSharedValue(0);
  const lifted = useSharedValue(0);
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.value = withTiming(shift, { duration: 140 });
  }, [shift, offset]);

  /*
   * The gesture is built ONCE per row and calls these stable JS functions,
   * which read the row's CURRENT index from a ref. Rebuilding the gesture when
   * the index changed (after a reorder) left react-native-gesture-handler on
   * web calling the old handler with the old index, so the second drag aimed
   * from the wrong slot and never moved anything.
   */
  const live = useRef({ index, onStart, onMove, onEnd });
  live.current = { index, onStart, onMove, onEnd };
  const jsStart = useCallback(() => live.current.onStart(live.current.index), []);
  const jsMove = useCallback(
    (ty: number) => live.current.onMove(live.current.index, ty),
    [],
  );
  const jsEnd = useCallback(() => live.current.onEnd(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(2)
        .onStart(() => {
          lifted.value = withTiming(1, { duration: 100 });
          runOnJS(jsStart)();
        })
        .onUpdate((e) => {
          dy.value = e.translationY;
          runOnJS(jsMove)(e.translationY);
        })
        .onEnd(() => {
          runOnJS(jsEnd)();
        })
        .onFinalize(() => {
          // Snap straight home: the list re-renders in its new order on the
          // same frame, so animating back would flash the old slot.
          dy.value = 0;
          lifted.value = withTiming(0, { duration: 120 });
        }),
    [jsStart, jsMove, jsEnd, dy, lifted],
  );

  const anim = useAnimatedStyle(() => ({
    transform: [
      { translateY: lifted.value > 0 ? dy.value : offset.value },
      { scale: 1 + lifted.value * 0.02 },
    ],
    zIndex: lifted.value > 0 ? 10 : 0,
  }));

  const grip = (
    <GestureDetector gesture={pan}>
      <View
        style={[styles.grip, Platform.OS === 'web' && styles.gripWeb]}
        hitSlop={8}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder, position ${index + 1} of ${count}`}
        accessibilityActions={[
          { name: 'increment', label: 'Move down' },
          { name: 'decrement', label: 'Move up' },
        ]}
        onAccessibilityAction={(e) =>
          onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1)
        }>
        {[0, 1, 2].map((r) => (
          <View key={r} style={styles.gripRow}>
            <View style={[styles.dot, { backgroundColor: c.textFaint }]} />
            <View style={[styles.dot, { backgroundColor: c.textFaint }]} />
          </View>
        ))}
      </View>
    </GestureDetector>
  );

  return (
    // Measured on a plain View: Reanimated's Animated.View does not forward
    // onLayout on web, which left every height at 0.
    <View ref={rowRef as never} onLayout={onLayout} style={dragging && styles.onTop}>
      <Animated.View
        style={[anim, dragging && [styles.lifted, { backgroundColor: c.bg, shadowColor: c.text }]]}>
        {render(grip)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  grip: {
    width: 22,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  // Claim the touch on web so dragging the grip doesn't scroll the page.
  gripWeb: { cursor: 'grab', touchAction: 'none' } as object,
  gripRow: { flexDirection: 'row', gap: 3 },
  // zIndex has to sit on the outer wrapper too, or later siblings paint over
  // the lifted row.
  onTop: { zIndex: 10 },
  dot: { width: 3.5, height: 3.5, borderRadius: 2 },
  // The one place Stock keeps a shadow besides the FAB: the row is
  // physically "in your hand".
  lifted: {
    borderRadius: 8,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});

export default SortableList;
