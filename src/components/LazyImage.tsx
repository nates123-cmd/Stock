import { useEffect, useRef, useState } from 'react';
import { Image, Platform, View, type ImageProps, type StyleProp, type ImageStyle } from 'react-native';

/**
 * An <Image> that doesn't decode until it's near the viewport.
 *
 * The recipe library renders every card in one `.map()` — 163 of them — and 43
 * carry a 700×700 base64 thumbnail baked into the recipe JSON. A JPEG only
 * costs its file size on disk; once decoded it costs width × height × 4 bytes
 * of live bitmap. 700 × 700 × 4 ≈ 1.9 MB each, so opening the page decoded
 * about 80 MB in one frame, on top of a 5.65 MB JSON blob.
 *
 * Desktop Chrome absorbs that. Mobile Safari kills the tab and shows
 * "A problem repeatedly occurred" — which is what Nate hit on /Stock/recipes.
 *
 * Deferring the decode means only the handful of cards actually on screen hold
 * a bitmap. Nothing about the stored data changes, so this is safe to ship on
 * its own; shrinking the stored thumbnails is a separate, lossy question.
 */
export function LazyImage({
  style,
  ...props
}: ImageProps & { style?: StyleProp<ImageStyle> }) {
  // Native has no IntersectionObserver and no tab-level memory ceiling to duck;
  // render normally there.
  const [visible, setVisible] = useState(Platform.OS !== 'web');
  const holder = useRef<View | null>(null);

  useEffect(() => {
    if (visible || Platform.OS !== 'web') return;
    // `holder` is a DOM node under react-native-web.
    const node = holder.current as unknown as Element | null;
    if (!node || typeof IntersectionObserver === 'undefined') {
      // No observer (old browser, test env) — degrade to eager rather than
      // showing a permanently blank card.
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      // Start decoding a screen ahead so scrolling doesn't show empty frames.
      { rootMargin: '600px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [visible]);

  if (visible) return <Image {...props} style={style} />;
  // Same box, no pixels — keeps layout identical while offscreen.
  return <View ref={holder} style={style} />;
}
