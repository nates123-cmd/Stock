import type { ReactNode } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { cuisineEnamel } from '@/design';

/**
 * The Enamel motif (DESIGN.md): a recipe with no photo is "cast" in its
 * cuisine's Le Creuset colour, with two lid rings cropped off the tile.
 *
 * Most of the library has no photo, so this is what most cards look like —
 * it replaces the empty tan square. Ring position is derived from the recipe
 * id, so two Italian recipes side by side never look like the same
 * placeholder twice, and a given recipe always looks the same.
 *
 * With a photo it just shows the photo; the enamel stays underneath as the
 * loading colour.
 */
export function EnamelTile({
  seed,
  cuisine,
  imageUrl,
  size,
  style,
  rings = true,
  children,
}: {
  /** Stable id — positions the rings. */
  seed: string;
  cuisine?: string | null;
  imageUrl?: string | null;
  /** Square side in px. Omit to fill the parent (set width/height via style). */
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Small row thumbs can drop the rings; they read as noise under ~40px. */
  rings?: boolean;
  /** Overlaid content (the recipe hero puts its title here). When there is a
   *  photo, a navy scrim is added under it so white type stays legible. */
  children?: ReactNode;
}) {
  const bg = cuisineEnamel(cuisine);
  const { x, y } = ringPos(seed);
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: bg },
        size != null && { width: size, height: size },
        style,
      ]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : rings ? (
        <>
          <View style={[styles.ring, styles.outer, { left: `${x}%`, top: `${y}%` }]} />
          <View style={[styles.ring, styles.inner, { left: `${x}%`, top: `${y}%` }]} />
        </>
      ) : null}
      {children && imageUrl ? <View style={styles.scrim} /> : null}
      {children}
    </View>
  );
}

/** Cheap stable hash → a ring centre near (but not on) an edge or corner. */
function ringPos(seed: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const spots = [
    { x: 85, y: 20 },
    { x: 10, y: 90 },
    { x: 70, y: 100 },
    { x: 0, y: 10 },
    { x: 100, y: 70 },
    { x: 40, y: -10 },
    { x: 95, y: 95 },
    { x: 15, y: 30 },
  ];
  return spots[(h >>> 0) % spots.length]!;
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', borderRadius: 6, position: 'relative' },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '65%',
    backgroundColor: 'rgba(18,33,49,0.55)',
  },
  ring: {
    position: 'absolute',
    aspectRatio: 1,
    borderRadius: 9999,
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: 2,
  },
  // Centred on (x, y) by pulling back half the size.
  outer: { width: '150%', transform: [{ translateX: '-50%' }, { translateY: '-50%' }] },
  inner: {
    width: '105%',
    borderColor: 'rgba(255,255,255,0.16)',
    transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
  },
});

export default EnamelTile;
