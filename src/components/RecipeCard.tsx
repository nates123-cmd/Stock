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
}: {
  recipe: Recipe;
  onPress?: () => void;
  /** Current favourite state. Omit to hide the star entirely. */
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** Current "to try" state. Omit `onToggleToTry` to hide the flag entirely. */
  toTry?: boolean;
  onToggleToTry?: () => void;
}) {
  const mods = modCount(recipe);
  const time = formatMinutes(recipe.yield.totalMinutes);
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
          ) : (
            <Glyph name="next" size={16} color="textFaint" />
          )}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { flex: 1 },
  fav: { paddingLeft: 4, paddingTop: 1 },
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
