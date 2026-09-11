import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Text,
  Heading,
  SectionLabel,
  Glyph,
  Button,
  BottomActionBar,
  SearchBar,
} from '@/components';
import { colors, layout } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { addComponent, indexRecipes, isDinner, newDinner } from '@/lib/dinners';

/**
 * New dinner — a name, and the recipes it combines.
 *
 * A dinner is a Recipe like any other (it just references others, see
 * lib/dinners), so it lands in the same library and gets planning, shopping,
 * favorites and folders for free. Picking the dishes here rather than only on
 * the detail screen is the whole point: a dinner with no dishes is nothing.
 */
export default function DinnerCapture() {
  const router = useRouter();
  const recipes = useRecipeStore((s) => s.recipes);
  const save = useRecipeStore((s) => s.save);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  /** selection order is the serve order, so keep an array not a Set */
  const [picked, setPicked] = useState<string[]>([]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/recipes'));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes
      .filter((r) => (q ? r.title.toLowerCase().includes(q) : true))
      .slice(0, 60);
  }, [recipes, query]);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const create = async () => {
    let dinner = newDinner(title);
    const index = indexRecipes(recipes);
    for (const id of picked) {
      const target = recipes.find((r) => r.id === id);
      if (target) dinner = addComponent(dinner, target, index);
    }
    // allowDuplicate: the dupe guard exists to stop import pipelines re-adding
    // the same recipe twice. A dinner is a deliberate new record, and sharing a
    // name with a dish you own ("Fried chicken") is normal, not a mistake.
    const res = await save(dinner, { allowDuplicate: true });
    if (res.ok) {
      router.replace({ pathname: '/recipes/[id]', params: { id: res.recipe.id } });
    } else {
      close();
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Heading variant="screenTitle">New dinner</Heading>
          <Pressable onPress={close} hitSlop={8}>
            <Text variant="bodyStrong" color="textMuted">
              Cancel
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          <View style={styles.field}>
            <SectionLabel color="textMuted">Name</SectionLabel>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Friday fried chicken, Taco night…"
              placeholderTextColor={colors.textFaint}
              style={styles.titleInput}
              autoFocus
            />
          </View>

          <View style={styles.field}>
            <SectionLabel color="textMuted">
              Recipes{picked.length > 0 ? ` · ${picked.length} picked` : ''}
            </SectionLabel>
            <SearchBar value={query} onChangeText={setQuery} />
            <View style={styles.list}>
              {matches.map((r) => {
                const on = picked.includes(r.id);
                return (
                  <Pressable
                    key={r.id}
                    style={styles.row}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => toggle(r.id)}>
                    <Glyph
                      name={on ? 'done' : 'add'}
                      size={15}
                      color={on ? 'accent' : 'textFaint'}
                    />
                    <View style={styles.rowText}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text color="textFaint" numberOfLines={1}>
                        {[
                          isDinner(r) ? 'dinner' : null,
                          `${r.ingredients.length} ingredients`,
                          r.cuisine ?? null,
                        ]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </Text>
                    </View>
                    {on ? (
                      <Text color="accent">{picked.indexOf(r.id) + 1}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text color="textFaint" style={styles.tip}>
            Add or reorder dishes later on the dinner itself. Once it has
            recipes, “Build cook plan” turns it into one timed run.
          </Text>
        </ScrollView>

        <BottomActionBar>
          <Button label="Cancel" variant="secondary" flex onPress={close} />
          <Button
            label="Create"
            glyph="add"
            flex
            disabled={!title.trim()}
            onPress={() => void create()}
          />
        </BottomActionBar>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    paddingBottom: 12,
  },
  body: { paddingHorizontal: layout.screenPadding, paddingBottom: 28, gap: 18 },
  field: { gap: 8 },
  titleInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  list: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowText: { flex: 1, gap: 1 },
  tip: { fontStyle: 'italic', lineHeight: 19 },
});
