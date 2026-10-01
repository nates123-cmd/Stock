import { Pressable, StyleSheet, View } from 'react-native';
import { Card } from './Card';
import { Text, Numeric } from './Text';
import { SourceBadge, Pill } from './Badge';
import { componentRefs, isDinner } from '@/lib/dinners';
import { Glyph } from './Glyph';
import { EnamelTile } from './EnamelTile';
import { colors } from '@/design';
import type { Recipe } from '@/types';
import { modCount } from '@/lib/recipe';
import { formatMinutes } from '@/lib/format';
import { cuisineLabel } from '@/lib/cuisine';

/** Library / list recipe card (spec §6 "Recipe cards"). */
export function RecipeCard({
  recipe,
  onPress,
  favorite,
  onToggleFavorite,
  toTry,
  onToggleToTry,
  onAdd,
  density = 'comfortable',
}: {
  recipe: Recipe;
  onPress?: () => void;
  /** Current favourite state. Omit to hide the star entirely. */
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** Current "to try" state. Omit `onToggleToTry` to hide the flag entirely. */
  toTry?: boolean;
  onToggleToTry?: () => void;
  /** Add affordance — when set, a red "+" button shows in the header (used by
   *  the plan picker to add a recipe to the week instead of opening it). */
  onAdd?: () => void;
  /**
   * `compact` draws a thin row instead of a card: 44px thumbnail on the left,
   * title and a single meta line, no tag chips. Roughly a quarter the height,
   * so a phone screen shows ~8 recipes instead of ~2. See the density toggle
   * in RecipeLibrary.
   */
  density?: 'comfortable' | 'compact';
}) {
  const mods = modCount(recipe);
  const time = formatMinutes(recipe.yield.totalMinutes);
  // A dinner is a recipe built from other recipes — say how many, so it reads
  // as a spread rather than as a recipe with a suspiciously short ingredient
  // list. Null for everything else, so the meta line is untouched.
  const dinnerCount = componentRefs(recipe).length;
  const dinnerLabel =
    isDinner(recipe) && dinnerCount > 0
      ? `dinner · ${dinnerCount} recipe${dinnerCount === 1 ? '' : 's'}`
      : null;

  if (density === 'compact') {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.row}>
          <EnamelTile
            seed={recipe.id}
            cuisine={recipe.cuisine}
            imageUrl={recipe.imageUrl}
            size={52}
          />
          <View style={styles.rowText}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.rowTitle}>
              {recipe.title}
            </Text>
            <Text color="textFaint" numberOfLines={1} style={styles.rowMeta}>
              {[
                dinnerLabel,
                recipe.cuisine ? recipe.cuisine : null,
                time ? `~${time}` : null,
                recipe.cookCount > 0 ? `cooked ${recipe.cookCount}×` : null,
              ]
                .filter(Boolean)
                .map((s) => (s === recipe.cuisine ? cuisineLabel(s as string) : s))
                .join(' · ') || `serves ${recipe.yield.serves}`}
            </Text>
          </View>
          {onToggleToTry ? (
            <Pressable
              onPress={onToggleToTry}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ selected: !!toTry }}
              accessibilityLabel={
                toTry
                  ? `Remove ${recipe.title} from to-try`
                  : `Mark ${recipe.title} to try`
              }>
              <Glyph
                name={toTry ? 'toTry' : 'toTryOff'}
                size={17}
                color={toTry ? 'accent' : 'textFaint'}
              />
            </Pressable>
          ) : null}
          {onToggleFavorite ? (
            <Pressable
              onPress={onToggleFavorite}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ selected: !!favorite }}
              accessibilityLabel={
                favorite
                  ? `Remove ${recipe.title} from favorites`
                  : `Add ${recipe.title} to favorites`
              }>
              <Glyph
                name={favorite ? 'fav' : 'favOff'}
                size={17}
                color={favorite ? 'accent' : 'textFaint'}
              />
            </Pressable>
          ) : null}
          {onAdd ? (
            <Pressable
              onPress={onAdd}
              hitSlop={8}
              style={styles.rowAddBtn}
              accessibilityRole="button"
              accessibilityLabel={`Add ${recipe.title}`}>
              <Glyph name="add" size={17} color="bg" />
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <Card style={styles.card}>
        <EnamelTile
          seed={recipe.id}
          cuisine={recipe.cuisine}
          imageUrl={recipe.imageUrl}
          style={styles.thumb}
        />
        <View style={styles.headerRow}>
          <Text variant="recipeTitle" style={styles.title}>
            {recipe.title}
          </Text>
          {onToggleToTry ? (
            <Pressable
              onPress={onToggleToTry}
              hitSlop={10}
              style={styles.fav}
              accessibilityRole="button"
              accessibilityState={{ selected: !!toTry }}
              accessibilityLabel={
                toTry
                  ? `Remove ${recipe.title} from to-try`
                  : `Mark ${recipe.title} to try`
              }>
              <Glyph
                name={toTry ? 'toTry' : 'toTryOff'}
                size={18}
                color={toTry ? 'accent' : 'textFaint'}
              />
            </Pressable>
          ) : null}
          {onToggleFavorite ? (
            // Its own press target so favouriting doesn't open the recipe.
            <Pressable
              onPress={onToggleFavorite}
              hitSlop={10}
              style={styles.fav}
              accessibilityRole="button"
              accessibilityState={{ selected: !!favorite }}
              accessibilityLabel={
                favorite
                  ? `Remove ${recipe.title} from favorites`
                  : `Add ${recipe.title} to favorites`
              }>
              <Glyph
                name={favorite ? 'fav' : 'favOff'}
                size={18}
                color={favorite ? 'accent' : 'textFaint'}
              />
            </Pressable>
          ) : null}
          {onAdd ? (
            <Pressable
              onPress={onAdd}
              hitSlop={8}
              style={styles.addBtn}
              accessibilityRole="button"
              accessibilityLabel={`Add ${recipe.title}`}>
              <Glyph name="add" size={20} color="bg" />
            </Pressable>
          ) : !onToggleFavorite ? (
            <Glyph name="next" size={16} color="textFaint" />
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <SourceBadge source={recipe.source} />
          {dinnerLabel ? <Pill label={dinnerLabel} tone="accent" /> : null}
          {mods > 0 ? <Pill label={`modified ${mods}`} tone="accent" /> : null}
        </View>

        <View style={styles.statRow}>
          <Numeric color="textMuted">
            {recipe.cookCount > 0 ? `cooked ${recipe.cookCount}×` : 'not cooked yet'}
          </Numeric>
          <Text color="textFaint"> · </Text>
          <Numeric color="textMuted">serves {recipe.yield.serves}</Numeric>
          {time ? (
            <>
              <Text color="textFaint"> · </Text>
              <Numeric color="textMuted">~{time}</Numeric>
            </>
          ) : null}
        </View>

        {recipe.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {recipe.tags.slice(0, 3).map((t) => (
              <View key={t} style={styles.tag}>
                <Text variant="sectionLabel" color="textMuted" style={styles.tagText}>
                  {t}
                </Text>
              </View>
            ))}
            {recipe.tags.length > 3 ? (
              <View style={styles.tag}>
                <Text variant="sectionLabel" color="textFaint" style={styles.tagText}>
                  +{recipe.tags.length - 3}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

/**
 * NYT-style shelf card for the library's horizontal rows: a big square tile
 * and exactly two scannable facts (time, cook count). Nothing else — the
 * shelves are for browsing; flags and stars live on the list rows below.
 */
export function ShelfCard({ recipe, onPress }: { recipe: Recipe; onPress?: () => void }) {
  const time = formatMinutes(recipe.yield.totalMinutes);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [shelf.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={recipe.title}>
      <EnamelTile
        seed={recipe.id}
        cuisine={recipe.cuisine}
        imageUrl={recipe.imageUrl}
        size={148}
      />
      <Text variant="bodyStrong" numberOfLines={2} style={shelf.title}>
        {recipe.title}
      </Text>
      <Text color="textFaint" numberOfLines={1} style={shelf.meta}>
        {time ? <Text color="textMuted" style={shelf.meta}>~{time}</Text> : null}
        {time ? ' · ' : ''}
        {recipe.cookCount > 0 ? `cooked ${recipe.cookCount}×` : 'new'}
      </Text>
    </Pressable>
  );
}

const shelf = StyleSheet.create({
  card: { width: 148 },
  title: { marginTop: 8, lineHeight: 19 },
  meta: { fontSize: 13, fontWeight: '500', marginTop: 3, fontVariant: ['tabular-nums'] },
});

const styles = StyleSheet.create({
  // Enamel: no card chrome — the tile and a hairline do the grouping.
  card: { gap: 10, backgroundColor: 'transparent', padding: 0, paddingBottom: 16 },
  thumb: { width: '100%', height: 168 },
  pressed: { opacity: 0.6 },
  /* --- compact row --- */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minWidth: 0,
  },
  rowTitle: { fontSize: 16 },
  rowMeta: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  // minWidth:0 is load-bearing on web: without it a long title refuses to
  // ellipsize and stretches the row past the viewport instead.
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  rowAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { flex: 1 },
  fav: { paddingLeft: 4, paddingTop: 1 },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  tag: {
    backgroundColor: colors.bg2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagText: { letterSpacing: 0.4 },
});

export default RecipeCard;
