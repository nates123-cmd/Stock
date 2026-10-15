import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  SectionLabel,
  Card,
  Button,
  BenchPanel,
  type BenchTab,
} from '@/components';
import { colors } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { useCookPlanStore } from '@/store/cookPlans';
import { indexRecipes } from '@/lib/dinners';
import { isSameDay, dayTag, dayLabel } from '@/lib/week';
import {
  cookWeek,
  leadEntry,
  entryDestination,
  dishDestination,
  entryTitle,
  type CookEntry,
  type CookableDish,
} from '@/lib/cookLaunch';
import type { Recipe } from '@/types';

/**
 * Cook launcher (redesign Phase C). Leads with the best guess for tonight —
 * today's dinner, else today's meal, else the soonest upcoming — and shows the
 * rest of the week under it so another night's dinner can be cooked instead
 * ("sometimes I switch up dinners"). Tapping a week row swaps the lead card;
 * "Open week plan" goes to the Plan tab proper.
 *
 * Everything that can be "on tonight" (a planned meal's dishes, a dinner's
 * linked recipes, a scheduled Cook Plan) opens on the SAME page the Plan tab
 * opens it on — see lib/cookLaunch for the routing. A dinner used to launch
 * straight into cook mode here, where it has no steps of its own.
 *
 * The screen is: TONIGHT, THIS WEEK, then BENCH inline (scale/convert/sub).
 */
export default function CookScreen() {
  const router = useRouter();
  const planMeals = usePlanStore((s) => s.meals);
  const recipes = useRecipeStore((s) => s.recipes);
  const cookPlans = useCookPlanStore((s) => s.plans);

  // Bench deep-links (recipe-detail "To grams" / long-press → Sub) land here.
  // Bench is inline now, so there's nothing to open — the params just seed the
  // panel, and benchKey remounts it when a fresh deep-link arrives.
  const benchParams = useLocalSearchParams<{
    bench?: string;
    tab?: BenchTab;
    text?: string;
    sub?: string;
    amount?: string;
    unit?: string;
  }>();
  const benchKey = `${benchParams.bench ?? ''}:${benchParams.tab ?? ''}:${benchParams.sub ?? ''}:${benchParams.text ?? ''}`;

  const index = useMemo(() => indexRecipes(recipes), [recipes]);

  // Today, re-anchored once a minute so a tab left open past midnight moves on.
  const [todayMs, setTodayMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTodayMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const today = useMemo(() => new Date(todayMs), [todayMs]);

  const week = useMemo(
    () => cookWeek(planMeals, cookPlans, index, today),
    [planMeals, cookPlans, index, today],
  );
  const lead = useMemo(() => leadEntry(week, today), [week, today]);

  // The card you picked from the week, if any; falls back to the lead when it
  // drops out of the window (cooked, skipped, moved).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const shown = (pickedId && week.find((e) => e.id === pickedId)) || lead;

  const open = (dest: ReturnType<typeof entryDestination>) => router.push(dest as never);

  return (
    <Screen>
      <View style={styles.header}>
        <Heading variant="screenTitle">Cook</Heading>
        <Text color="textMuted">what's on tonight</Text>
      </View>

      <SectionLabel style={styles.label}>
        {shown && isSameDay(shown.date, today) ? 'Tonight' : 'Up next'}
      </SectionLabel>
      {shown ? (
        <LeadCard entry={shown} onOpen={open} />
      ) : (
        <Card style={styles.mealCard}>
          <Text color="textMuted">Nothing planned to cook.</Text>
          <Text color="textFaint">Plan a meal, or pick a recipe from Recipes.</Text>
        </Card>
      )}

      {/* The week: every day with something to cook. Tap a row to lead with
          it instead; the button opens the real week grid on the Plan tab. */}
      <SectionLabel style={styles.label}>This week</SectionLabel>
      <Card bordered style={styles.weekCard}>
        {week.length > 0 ? (
          week.map((entry) => {
            const { dow, date } = dayLabel(entry.date);
            const active = shown?.id === entry.id;
            return (
              <Pressable
                key={`${entry.kind}:${entry.id}`}
                style={[styles.weekRow, active && styles.weekRowActive]}
                onPress={() => setPickedId(entry.id)}
                accessibilityRole="button"
                accessibilityLabel={`${dow} ${date}: ${entryTitle(entry)}`}>
                <View style={styles.weekDay}>
                  <Text variant="sectionLabel" color={active ? 'accent' : 'textMuted'}>
                    {dow}
                  </Text>
                  <Text variant="bodyStrong" color={active ? 'accent' : 'text'}>
                    {date}
                  </Text>
                </View>
                <View style={styles.weekText}>
                  <Text variant={active ? 'bodyStrong' : 'body'} numberOfLines={2}>
                    {entryTitle(entry)}
                  </Text>
                  <Text color="textFaint">
                    {entry.kind === 'plan'
                      ? `cook plan · serves ${timeOf(entry.date)}`
                      : entry.meal.type ?? 'meal'}
                  </Text>
                </View>
              </Pressable>
            );
          })
        ) : (
          <Text color="textMuted">Nothing on the week yet.</Text>
        )}
        <Button
          label="Open week plan"
          glyph="plan"
          variant="secondary"
          onPress={() => router.push({ pathname: '/plan', params: { segment: 'plan' } } as never)}
        />
      </Card>

      {/* Bench sits under the week, inline — no sheet to open. Cook is what
          you're cooking and the tools to cook it; the recipe grid lives on the
          Recipes tab. */}
      <SectionLabel style={styles.label}>Bench</SectionLabel>
      {/* Keyed on the deep-link params so arriving from a recipe's "To grams" /
          "Sub" re-seeds the panel instead of showing a stale one. */}
      <BenchPanel
        key={benchKey}
        initialTab={benchParams.tab}
        initialText={benchParams.text ?? ''}
        initialSub={benchParams.sub ?? ''}
        initialAmount={benchParams.amount ?? ''}
        initialUnit={benchParams.unit ?? ''}
      />
    </Screen>
  );
}

/**
 * The lead card. A meal lists its dishes; a dinner dish also lists the recipes
 * it links, each cookable on its own. A cook plan shows its spread and opens
 * on the plan's own page (the Plan tab's door), where "Run this cook" lives.
 */
function LeadCard({
  entry,
  onOpen,
}: {
  entry: CookEntry;
  onOpen: (dest: ReturnType<typeof entryDestination>) => void;
}) {
  if (entry.kind === 'plan') {
    const { plan } = entry;
    return (
      <Card bordered style={styles.mealCard}>
        <View style={styles.mealHead}>
          <Text variant="recipeTitle">{plan.title}</Text>
          <Text color="textMuted">
            {dayTag(entry.date)} · {timeOf(entry.date)}
          </Text>
        </View>
        {plan.spread.length > 0 ? (
          <Text color="textMuted">{plan.spread.join(' · ')}</Text>
        ) : null}
        <Text color="textFaint">
          cook plan · {plan.components.length} components · {plan.phases.length} phases
        </Text>
        <Button label="Open cook plan" glyph="next" onPress={() => onOpen(entryDestination(entry))} />
      </Card>
    );
  }

  const { meal, dishes } = entry;
  // Every dish's photo — and a dinner's parts' photos — not just the first:
  // the point of the picture is recognising WHICH thing. One photo keeps the
  // full-width hero; two or more tile.
  const photos: { key: string; recipe: Recipe; dest: ReturnType<typeof dishDestination> }[] = [];
  for (const d of dishes) {
    if (d.dinner) {
      for (const part of d.parts) {
        if (part.imageUrl) photos.push({ key: `${d.dish.id}:${part.id}`, recipe: part, dest: cookDest(part) });
      }
    } else if (d.recipe.imageUrl) {
      photos.push({ key: d.dish.id, recipe: d.recipe, dest: dishDestination(d) });
    }
  }
  const title =
    dishes.length > 1 ? `${dishes.length} dishes` : dishes[0]?.recipe.title ?? 'Tonight';

  return (
    <Card bordered style={styles.mealCard}>
      {photos.length > 0 ? (
        <View style={styles.photoRow}>
          {photos.map(({ key, recipe, dest }) => (
            <Pressable
              key={key}
              style={[styles.photoTile, photos.length === 1 && styles.photoSolo]}
              onPress={() => onOpen(dest)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${recipe.title}`}>
              <Image
                source={{ uri: recipe.imageUrl }}
                style={[styles.photoImg, photos.length === 1 && styles.photoImgSolo]}
                resizeMode="cover"
              />
              {photos.length > 1 ? (
                <Text color="textFaint" numberOfLines={1} style={styles.photoCaption}>
                  {recipe.title}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.mealHead}>
        <Text variant="recipeTitle">{title}</Text>
        <Text color="textMuted">
          {dayTag(meal.date)}
          {meal.type ? ` · ${meal.type}` : ''}
        </Text>
      </View>

      <View style={styles.dishList}>
        {dishes.map((d) => (
          <DishRows key={d.dish.id} dish={d} onOpen={onOpen} />
        ))}
      </View>

      {dishes.length >= 2 ? (
        <Button
          label="Combine into one timeline"
          glyph="cook"
          onPress={() => onOpen({ pathname: '/cook/meal/[id]', params: { id: meal.id } })}
        />
      ) : dishes[0] ? (
        <Button
          label={dishes[0].dinner ? 'Open the dinner' : 'Start cooking'}
          glyph="next"
          onPress={() => onOpen(dishDestination(dishes[0]!))}
        />
      ) : null}
    </Card>
  );
}

/** A dish row; a dinner's row is followed by one row per linked recipe. */
function DishRows({
  dish,
  onOpen,
}: {
  dish: CookableDish;
  onOpen: (dest: ReturnType<typeof dishDestination>) => void;
}) {
  const { recipe } = dish;
  return (
    <>
      <Pressable style={styles.dishRow} onPress={() => onOpen(dishDestination(dish))} accessibilityRole="button">
        <View style={styles.dishText}>
          <Text variant="bodyStrong">{recipe.title}</Text>
          <Text color="textFaint">
            {dish.dinner ? `dinner · ${dish.parts.length} recipes` : `serves ${recipe.yield.serves}`}
          </Text>
        </View>
        <Text color="accent" variant="bodyStrong">
          {dish.dinner ? 'Open' : 'Cook'}
        </Text>
      </Pressable>
      {dish.parts.map((part) => (
        <Pressable
          key={`${dish.dish.id}:${part.id}`}
          style={[styles.dishRow, styles.partRow]}
          onPress={() => onOpen(cookDest(part))}
          accessibilityRole="button">
          <View style={styles.dishText}>
            <Text variant="body">{part.title}</Text>
            <Text color="textFaint">serves {part.yield.serves}</Text>
          </View>
          <Text color="accent" variant="bodyStrong">
            Cook
          </Text>
        </Pressable>
      ))}
    </>
  );
}

const cookDest = (recipe: Recipe) =>
  ({ pathname: '/cook/[id]', params: { id: recipe.id } }) as const;

const timeOf = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 14,
  },
  label: { paddingTop: 8, paddingBottom: 10 },
  mealCard: { gap: 12, borderColor: colors.line },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoTile: { flexBasis: '48%', flexGrow: 1, gap: 4 },
  photoSolo: { flexBasis: '100%' },
  photoImg: { width: '100%', height: 104, borderRadius: 10, backgroundColor: colors.bg2 },
  photoImgSolo: { height: 160 },
  photoCaption: { paddingHorizontal: 2 },
  mealHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  dishList: { gap: 2 },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  partRow: { paddingLeft: 16 },
  dishText: { gap: 2, flex: 1 },
  weekCard: { gap: 4, borderColor: colors.line, marginBottom: 4 },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  weekRowActive: { backgroundColor: colors.bg3 },
  weekDay: { width: 36, alignItems: 'center' },
  weekText: { flex: 1, gap: 2 },
});
