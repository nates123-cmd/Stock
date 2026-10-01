/**
 * Enamel — Le Creuset colourways, sampled from the brand's swatch chart
 * (DESIGN.md). Each cuisine is "cast" in one, the way a pot is: a recipe with
 * no photo shows a tile of its cuisine's enamel instead of an empty square.
 *
 * Families share a colour on purpose. Twenty cuisines in twenty near-identical
 * hues would be noise; nine distinct enamels grouped by kitchen read at a
 * glance. Flame is NOT here — it is reserved for actions.
 */
import { normCuisine } from '@/lib/cuisine';

export const enamel = {
  artichaut: '#28463C',
  marseille: '#05569D',
  rhone: '#5D0A11',
  caribbean: '#067D96',
  nectar: '#E59307',
  olive: '#5B5216',
  cerise: '#B90505',
  azure: '#27578F',
  sage: '#80A29A',
  seaSalt: '#72898B',
} as const;

export type EnamelName = keyof typeof enamel;

const BY_CUISINE: Record<string, EnamelName> = {
  italian: 'artichaut',
  french: 'marseille',
  british: 'marseille',
  german: 'marseille',
  'eastern european': 'marseille',
  spanish: 'rhone',
  greek: 'caribbean',
  caribbean: 'caribbean',
  american: 'caribbean',
  'middle eastern': 'nectar',
  'north african': 'nectar',
  indian: 'olive',
  mexican: 'olive',
  'latin american': 'olive',
  chinese: 'cerise',
  korean: 'cerise',
  japanese: 'azure',
  thai: 'sage',
  vietnamese: 'sage',
};

/** The enamel a recipe is cast in. Unknown / missing cuisine → Sea Salt. */
export function cuisineEnamel(cuisine?: string | null): string {
  if (!cuisine) return enamel.seaSalt;
  return enamel[BY_CUISINE[normCuisine(cuisine)] ?? 'seaSalt'];
}
