import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/**
 * Recipe photos.
 *
 * `Recipe.imageUrl` is just a URI the <Image> renders, and until now only the
 * JSON-LD scraper ever set it. This lets you shoot or pick one yourself.
 *
 * The result is stored as a **downscaled data URI**, not a remote URL: it rides
 * along in the existing `recipes` row, keeps working offline, and needs no
 * bucket/RLS setup. The cost is row size — hence the hard downscale below. If
 * the library ever gets big enough that the rows hurt, swap `toStoredUri` for a
 * Supabase Storage upload and nothing else has to change.
 */

/**
 * Longest edge, in px, of a stored recipe photo.
 *
 * 384, not 1024. A data URI costs its byte size in the row but
 * width × height × 4 bytes of live bitmap the moment it's decoded, and the
 * recipe library renders every card at once — 163 of them. At 1024 that's
 * 4.2 MB of bitmap per photo; at 700 (where the imported thumbnails sat) it
 * was 1.9 MB each, and 43 of them decoded 80 MB in one frame and killed the
 * tab on mobile Safari.
 *
 * Cards display these at roughly 365 × 124, so 384 is already generous. Raise
 * it only if you also stop decoding the whole library at once.
 */
const MAX_EDGE = 384;
const JPEG_QUALITY = 0.8;

const WEB = Platform.OS === 'web';

/**
 * Re-encode an image URI down to <=MAX_EDGE on its long side as a JPEG data URI.
 *
 * Web only — native has no canvas. On native we fall back to the picker's own
 * compression, which is good enough there and avoids pulling in
 * expo-image-manipulator for a PWA-first app.
 */
async function toStoredUri(uri: string): Promise<string> {
  if (!WEB) return uri;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read that image.'));
    el.crossOrigin = 'anonymous';
    el.src = uri;
  });

  const { width, height } = img;
  if (!width || !height) throw new Error('Could not read that image.');

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return uri;
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

export type PhotoSource = 'camera' | 'library';

/**
 * Shoot or pick a recipe photo. Resolves to a storable URI, or null if the user
 * backed out. Throws with a user-facing message if permission is refused.
 */
export async function pickRecipePhoto(source: PhotoSource): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Camera access is off — enable it in settings to take a photo.');
    }
  } else if (!WEB) {
    // Web's library path is a plain file input; it needs no permission grant.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Photo access is off — enable it in settings to choose a photo.');
    }
  }

  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: JPEG_QUALITY,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled) return null;
  const uri = result.assets[0]?.uri;
  if (!uri) return null;

  return toStoredUri(uri);
}
