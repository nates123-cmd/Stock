import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text, Numeric } from './Text';
import { Glyph } from './Glyph';
import { Button } from './Button';
import { Overlay } from './Overlay';
import { FilterChip, ChipRow } from './Chip';
import { colors } from '@/design';
import { convertToGrams } from '@/lib/parsing';
import { formatAmount } from '@/lib/format';
import { usePrefsStore } from '@/store/prefs';
import type { Ingredient, Recipe } from '@/types';

/**
 * The two recipe-aware bench tools — "To grams" and "Scale" — plus their
 * overlays.
 *
 * These used to live inline in the recipe-detail screen, which meant the screen
 * you actually stand at while cooking (cook/[id], reached from the Cook tab)
 * had no way to convert or scale: exactly when you need it most. Both surfaces
 * now render this, so the behaviour can't drift between them.
 *
 * Both tools write through to the recipe (via `onSave`) — a conversion is a
 * transformation, not an edit, so neither pushes a Modification / strikethrough
 * diff.
 *
 * `children` render as leading buttons inside the same toolbar row (the recipe
 * screen puts its "Cook" button there).
 */
export type RecipeToolsProps = {
  recipe: Recipe;
  onSave: (r: Recipe) => Promise<void> | void;
  /** Result/error copy is surfaced by the parent so it can sit with the parent's own hints. */
  onHint: (message: string | null) => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function RecipeTools({ recipe, onSave, onHint, children, style }: RecipeToolsProps) {
  const [converting, setConverting] = useState(false);
  /** Conversion preview — each candidate is the ingredient + its proposed grams. */
  const [convertPreview, setConvertPreview] = useState<
    Array<{ ing: Ingredient; grams: number }> | null
  >(null);
  /** ids the user has unchecked in the preview (default = all on). */
  const [convertOff, setConvertOff] = useState<Set<string>>(new Set());
  /** Non-null while the Scale overlay is open; carries the proposed serves. */
  const [scalingTo, setScalingTo] = useState<number | null>(null);
  /** Scale overlay mode: by servings (×N) or pinned to one ingredient's amount. */
  const [scaleMode, setScaleMode] = useState<'serves' | 'ingredient'>('serves');
  /** Ingredient mode: which ingredient is pinned + the amount you actually have. */
  const [pivotId, setPivotId] = useState<string | null>(null);
  const [pivotTarget, setPivotTarget] = useState('');

  // Sticky "to grams". Once you apply a conversion, `preferGrams` turns on and
  // every recipe auto-converts the first time it's opened — so you never press
  // the button again. See [[store/prefs]].
  const preferGrams = usePrefsStore((s) => s.preferGrams);
  const setPreferGrams = usePrefsStore((s) => s.setPreferGrams);
  // Guard: don't re-attempt auto-convert for the same recipe every render.
  const autoTried = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!preferGrams) return;
    if (autoTried.current.has(recipe.id)) return;
    // Anything non-gram with a real amount + unit is convertible.
    const hasConvertible = recipe.ingredients.some(
      (i) => i.amount != null && i.amount > 0 && i.unit && !/^(g|kg|mg)$/i.test(i.unit.trim()),
    );
    if (!hasConvertible) return;
    autoTried.current.add(recipe.id);
    let alive = true;
    void (async () => {
      try {
        const results = await convertToGrams(recipe.ingredients);
        if (!alive || results.length === 0) return;
        const byId = new Map(results.map((r) => [r.id, r.grams]));
        const updated = recipe.ingredients.map((ing) => {
          const grams = byId.get(ing.id);
          return grams == null ? ing : { ...ing, amount: grams, unit: 'g' };
        });
        await onSave({ ...recipe, ingredients: updated, modifiedAt: new Date() });
      } catch {
        // Offline / no Claude / parse fail — leave the recipe as-is, silently.
        // Allow a later retry for this recipe.
        autoTried.current.delete(recipe.id);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferGrams, recipe.id]);

  const previewConvertToGrams = async () => {
    setConverting(true);
    onHint(null);
    try {
      const results = await convertToGrams(recipe.ingredients);
      if (results.length === 0) {
        onHint(
          'Nothing to convert — all amounts are already in grams (or are counted items / to-taste).',
        );
        return;
      }
      const byId = new Map(results.map((r) => [r.id, r.grams]));
      const candidates = recipe.ingredients
        .filter((i) => byId.has(i.id))
        .map((ing) => ({ ing, grams: byId.get(ing.id) as number }));
      setConvertPreview(candidates);
      setConvertOff(new Set());
    } catch (e) {
      onHint(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setConverting(false);
    }
  };

  const applyConversionPreview = async () => {
    if (!convertPreview) return;
    const toApply = convertPreview.filter((c) => !convertOff.has(c.ing.id));
    if (toApply.length === 0) {
      setConvertPreview(null);
      return;
    }
    const byId = new Map(toApply.map((c) => [c.ing.id, c.grams]));
    // Pure data update — unit conversion is a transformation, not an edit,
    // so don't push a Modification (no strikethrough diff).
    const updated = recipe.ingredients.map((ing) => {
      const grams = byId.get(ing.id);
      if (grams == null) return ing;
      return { ...ing, amount: grams, unit: 'g' };
    });
    await onSave({ ...recipe, ingredients: updated, modifiedAt: new Date() });
    // Make it sticky: from now on, new recipes auto-convert to grams on open.
    if (!preferGrams) setPreferGrams(true);
    onHint(
      `Converted ${toApply.length} ${toApply.length === 1 ? 'ingredient' : 'ingredients'} to grams. New recipes will convert automatically.`,
    );
    setConvertPreview(null);
  };

  const toggleConvertCandidate = (id: string) =>
    setConvertOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyScale = async () => {
    if (scalingTo == null || scalingTo === recipe.yield.serves || scalingTo < 1) {
      setScalingTo(null);
      return;
    }
    const ratio = scalingTo / recipe.yield.serves;
    const updated = recipe.ingredients.map((ing) =>
      ing.amount == null
        ? ing
        : { ...ing, amount: Math.round(ing.amount * ratio * 100) / 100 },
    );
    await onSave({
      ...recipe,
      ingredients: updated,
      yield: { ...recipe.yield, serves: scalingTo },
      modifiedAt: new Date(),
    });
    onHint(`Scaled to ${scalingTo} servings.`);
    setScalingTo(null);
  };

  // Ingredient-pivot scaling (spec §9 extension): pin one ingredient to the
  // amount you actually have, scale everything else by that ratio. Use case:
  // only 600 g of pepper on hand → set pepper to 600 g, the rest follows.
  const scalable = recipe.ingredients.filter((i) => i.amount != null);
  const pivot = recipe.ingredients.find((i) => i.id === pivotId) ?? null;
  const pivotRatio = (() => {
    const t = parseFloat(pivotTarget);
    if (!pivot || pivot.amount == null || !Number.isFinite(t) || t <= 0) return null;
    return t / pivot.amount;
  })();

  const applyScaleByIngredient = async () => {
    if (!pivot || pivot.amount == null || pivotRatio == null) {
      setScalingTo(null);
      return;
    }
    const ratio = pivotRatio;
    const updated = recipe.ingredients.map((ing) =>
      ing.amount == null
        ? ing
        : { ...ing, amount: Math.round(ing.amount * ratio * 100) / 100 },
    );
    const newServes = Math.max(1, Math.round(recipe.yield.serves * ratio));
    await onSave({
      ...recipe,
      ingredients: updated,
      yield: { ...recipe.yield, serves: newServes },
      modifiedAt: new Date(),
    });
    onHint(
      `Scaled to ${formatAmount(Math.round(parseFloat(pivotTarget) * 100) / 100, pivot.unit)} ${pivot.canonicalName}.`,
    );
    setScalingTo(null);
  };

  const openScale = () => {
    setScaleMode('serves');
    setPivotId(recipe.ingredients.find((i) => i.amount != null)?.id ?? null);
    setPivotTarget('');
    setScalingTo(recipe.yield.serves);
  };

  return (
    <>
      <View style={[styles.toolbar, style]}>
        {children}
        <Button
          label={converting ? 'Converting…' : 'To grams'}
          glyph="bench"
          variant="secondary"
          flex
          disabled={converting}
          onPress={previewConvertToGrams}
        />
        <Button label="Scale" variant="secondary" flex onPress={openScale} />
      </View>

      <Overlay visible={scalingTo != null} onClose={() => setScalingTo(null)}>
        {scalingTo != null ? (
          <View style={styles.scaleSheet}>
            <Text variant="recipeTitle">Scale recipe</Text>
            <ChipRow>
              <FilterChip
                label="By servings"
                active={scaleMode === 'serves'}
                onPress={() => setScaleMode('serves')}
              />
              <FilterChip
                label="By ingredient"
                active={scaleMode === 'ingredient'}
                onPress={() => setScaleMode('ingredient')}
              />
            </ChipRow>

            {scaleMode === 'serves' ? (
              <>
                <Text color="textFaint" style={styles.scaleHint}>
                  Multiplies all amounts. Tweak anything weird afterward (tap an
                  ingredient to fine-tune).
                </Text>
                <View style={styles.scaleControl}>
                  <Pressable
                    onPress={() => setScalingTo(Math.max(1, scalingTo - 1))}
                    style={styles.scaleBtn}
                    hitSlop={8}>
                    <Text variant="recipeTitle">−</Text>
                  </Pressable>
                  <View style={styles.scaleNumWrap}>
                    <Numeric color="text" style={styles.scaleNum}>
                      {scalingTo}
                    </Numeric>
                    <Text color="textMuted">servings</Text>
                  </View>
                  <Pressable
                    onPress={() => setScalingTo(Math.min(99, scalingTo + 1))}
                    style={styles.scaleBtn}
                    hitSlop={8}>
                    <Text variant="recipeTitle">+</Text>
                  </Pressable>
                </View>
                <Text color="textMuted" style={styles.scaleRatio}>
                  {scalingTo === recipe.yield.serves
                    ? `Same as current (${recipe.yield.serves})`
                    : `${(scalingTo / recipe.yield.serves).toFixed(2).replace(/\.?0+$/, '')}× from ${recipe.yield.serves}`}
                </Text>
              </>
            ) : (
              <>
                <Text color="textFaint" style={styles.scaleHint}>
                  Pin one ingredient to the amount you actually have — everything
                  else scales to match.
                </Text>
                <ChipRow>
                  {scalable.map((ing) => (
                    <FilterChip
                      key={ing.id}
                      label={ing.canonicalName}
                      active={pivotId === ing.id}
                      onPress={() => setPivotId(ing.id)}
                    />
                  ))}
                </ChipRow>
                {pivot ? (
                  <View style={styles.pivotInputRow}>
                    <Text color="textMuted">I have</Text>
                    <TextInput
                      value={pivotTarget}
                      onChangeText={setPivotTarget}
                      keyboardType="numeric"
                      placeholder={pivot.amount != null ? String(pivot.amount) : '—'}
                      placeholderTextColor={colors.textFaint}
                      style={styles.pivotInput}
                    />
                    <Text color="textMuted">
                      {pivot.unit ?? ''} {pivot.canonicalName}
                    </Text>
                  </View>
                ) : null}
                <Text color="textMuted" style={styles.scaleRatio}>
                  {pivotRatio == null
                    ? 'Enter an amount to preview'
                    : `${Math.round(pivotRatio * 100) / 100}× from ${formatAmount(pivot!.amount, pivot!.unit)}`}
                </Text>
              </>
            )}

            <ScrollView style={styles.scaleList}>
              {recipe.ingredients.map((ing) => {
                if (ing.amount == null) return null;
                const ratio =
                  scaleMode === 'serves' ? scalingTo / recipe.yield.serves : pivotRatio;
                const newAmt =
                  ratio == null ? ing.amount : Math.round(ing.amount * ratio * 100) / 100;
                return (
                  <View key={ing.id} style={styles.scaleRow}>
                    <Text style={styles.convertName} numberOfLines={1}>
                      {ing.canonicalName}
                    </Text>
                    <Numeric color="textMuted">
                      {formatAmount(ing.amount, ing.unit)} → {formatAmount(newAmt, ing.unit)}
                    </Numeric>
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.convertButtons}>
              <Button
                label="Cancel"
                variant="secondary"
                flex
                onPress={() => setScalingTo(null)}
              />
              <Button
                label="Apply"
                glyph="done"
                flex
                disabled={
                  scaleMode === 'serves'
                    ? scalingTo === recipe.yield.serves
                    : pivotRatio == null || pivotRatio === 1
                }
                onPress={scaleMode === 'serves' ? applyScale : applyScaleByIngredient}
              />
            </View>
          </View>
        ) : null}
      </Overlay>

      <Overlay visible={convertPreview != null} onClose={() => setConvertPreview(null)}>
        {convertPreview ? (
          <View style={styles.convertSheet}>
            <Text variant="recipeTitle">Convert to grams</Text>
            <Text color="textFaint" style={styles.convertHint}>
              Uncheck anything you'd rather keep in its original units.
            </Text>
            <ScrollView style={styles.convertList}>
              {convertPreview.map(({ ing, grams }) => {
                const on = !convertOff.has(ing.id);
                return (
                  <Pressable
                    key={ing.id}
                    onPress={() => toggleConvertCandidate(ing.id)}
                    style={styles.convertRow}>
                    <View style={[styles.convertCheck, on && styles.convertCheckOn]}>
                      {on ? <Glyph name="done" size={12} color="bg" /> : null}
                    </View>
                    <Text style={styles.convertName}>{ing.canonicalName}</Text>
                    <Numeric color="textMuted">
                      {formatAmount(ing.amount, ing.unit)} → {grams} g
                    </Numeric>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.convertButtons}>
              <Button
                label="Cancel"
                variant="secondary"
                flex
                onPress={() => setConvertPreview(null)}
              />
              <Button
                label={`Convert ${convertPreview.length - convertOff.size}`}
                glyph="done"
                flex
                disabled={convertPreview.length - convertOff.size === 0}
                onPress={applyConversionPreview}
              />
            </View>
          </View>
        ) : null}
      </Overlay>
    </>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 10 },
  scaleSheet: { gap: 14 },
  scaleHint: { fontStyle: 'italic', lineHeight: 18 },
  scaleControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 4,
  },
  scaleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleNumWrap: { alignItems: 'center', minWidth: 90 },
  scaleNum: { fontSize: 28 },
  scaleRatio: { textAlign: 'center', fontStyle: 'italic' },
  scaleList: { maxHeight: 240 },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  pivotInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pivotInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 90,
    fontSize: 15,
    color: colors.text,
  },
  convertSheet: { gap: 12 },
  convertHint: { fontStyle: 'italic', lineHeight: 18 },
  convertList: { maxHeight: 320 },
  convertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  convertCheck: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convertCheckOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  convertName: { flex: 1 },
  convertButtons: { flexDirection: 'row', gap: 10, paddingTop: 4 },
});
