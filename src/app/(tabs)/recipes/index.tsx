import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  RecipeLibrary,
  Fab,
  Overlay,
} from '@/components';
import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';

export default function RecipesLibrary() {
  const router = useRouter();
  const recipeCount = useRecipeStore((s) => s.recipes.length);
  /** The + sheet: recipe, idea, or a cook plan. */
  const [addOpen, setAddOpen] = useState(false);

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <View>
            <Heading variant="screenTitle">Recipes</Heading>
            <Text color="textMuted">{recipeCount} saved</Text>
          </View>
        </View>

        <RecipeLibrary
          onSelectRecipe={(r) =>
            router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
          }
          onSelectIdea={(idea) =>
            router.push({ pathname: '/idea/[id]', params: { id: idea.id } })
          }
          onSelectPlan={(p) =>
            router.push({ pathname: '/cook-plan/[id]', params: { id: p.id } })
          }
        />
      </Screen>

      {/* The ONE capture entry point, and only on this tab. It asks what you're
          adding rather than guessing. */}
      <Fab onPress={() => setAddOpen(true)} />

      <Overlay visible={addOpen} onClose={() => setAddOpen(false)}>
        <View style={styles.addSheet}>
          <Heading variant="recipeTitle">Add</Heading>
          <Pressable
            style={styles.addChoice}
            accessibilityRole="button"
            onPress={() => {
              setAddOpen(false);
              router.push('/capture');
            }}>
            <Text variant="bodyStrong">Recipe</Text>
            <Text color="textFaint">
              A full recipe — paste a link or text, or write it out.
            </Text>
          </Pressable>
          <Pressable
            style={styles.addChoice}
            accessibilityRole="button"
            onPress={() => {
              setAddOpen(false);
              router.push('/idea-capture');
            }}>
            <Text variant="bodyStrong">Idea</Text>
            <Text color="textFaint">
              A half-baked idea — a dish, an ingredient, a link. Lands in To Try.
            </Text>
          </Pressable>
          <Pressable
            style={styles.addChoice}
            accessibilityRole="button"
            onPress={() => {
              setAddOpen(false);
              router.push('/cook-plan-capture');
            }}>
            <Text variant="bodyStrong">Cook plan</Text>
            <Text color="textFaint">A whole-meal production.</Text>
          </Pressable>
          <Pressable
            style={styles.addCancel}
            onPress={() => setAddOpen(false)}
            accessibilityRole="button">
            <Text color="textMuted">Cancel</Text>
          </Pressable>
        </View>
      </Overlay>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 14,
  },
  addSheet: { gap: 4, paddingBottom: 8 },
  addChoice: {
    paddingVertical: 14,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  addCancel: { paddingVertical: 14, alignItems: 'center' },
});
