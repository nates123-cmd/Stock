import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Card } from './Card';
import { Text, Numeric } from './Text';
import { SourceBadge, Pill } from './Badge';
import { Glyph } from './Glyph';
import { colors } from '@/design';
import type { Recipe } from '@/types';
import { modCount } from '@/lib/recipe';
import { formatMinutes } from '@/lib/format';

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

  if (density === 'compact') {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
        <View style={styles.row}>
          {recipe.imageUrl ? (
            <Image
              source={{ uri: recipe.imageUrl }}
              style={styles.rowThumb}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.rowThumb} />
          )}
          <View style={styles.rowText}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {recipe.title}
            </Text>
            <Text color="textFaint" numberOfLines={1}>
              {[
                recipe.cuisine ? recipe.cuisine : null,
                time ? `~${time}` : null,
                recipe.cookCount > 0 ? `cooked ${recipe.cookCount}×` : null,
              ]
                .filter(Boolean)
                .join('  ·  ') || `serves ${recipe.yield.serves}`}
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
        {recipe.imageUrl ? (
          <Image
            source={{ uri: recipe.imageUrl }}
            style={styles.thumb}
            resizeMode="cover"
          />
        ) : null}
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

const styles = StyleSheet.create({
  card: { gap: 10 },
  thumb: { width: '100%', height: 124, borderRadius: 10, backgroundColor: colors.bg2 },
  pressed: { opacity: 0.6 },
  /* --- compact row --- */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    minWidth: 0,
  },
  rowThumb: { width: 44, height: 44, borderRadius: 7, backgroundColor: colors.bg3 },
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
    backgroundColor: colors.bg3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagText: { letterSpacing: 0.4 },
});

export default RecipeCard;
