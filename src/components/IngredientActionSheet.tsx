import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text, Heading, Numeric, SectionLabel } from './Text';
import { Button } from './Button';
import { Overlay } from './Overlay';
import { colors } from '@/design';
import { formatAmount } from '@/lib/format';
import { usePantryStore } from '@/store/pantry';
import { pantryRowFor } from '@/lib/ingredientPantry';
import { parseAmount } from '@/lib/amountInput';
import type { Ingredient, PantryStatus, Unit } from '@/types';

/** What the inline Edit hands back. */
export type IngredientEdit = { amount: number | null; unit: Unit | null; name: string };

const STATUS_LABEL: Record<PantryStatus, string> = {
  fine: 'Have it',
  low: 'Running low',
  out: 'Out',
};

/**
 * Tap an ingredient on a recipe → one sheet with everything you might want to
 * do to it standing at the counter:
 *
 *  - pantry status (Have it / Running low / Out), written to the matching
 *    pantry row or a new one, so the shopping list picks it up
 *  - always-have pin on that pantry row
 *  - Sub (hands off to SubSheet), Edit (inline amount / unit / name),
 *    Add to shopping list (one-off extra), Remove from recipe
 *
 * Long-press still jumps straight to Sub; this is the tap.
 */
export function IngredientActionSheet({
  ingredient,
  recipeTitle,
  onClose,
  onSub,
  onEdit,
  onAddToShopping,
  onRemove,
  onHint,
}: {
  ingredient: Ingredient | null;
  recipeTitle: string;
  onClose: () => void;
  onSub: (ing: Ingredient) => void;
  onEdit: (ing: Ingredient, next: IngredientEdit) => void;
  onAddToShopping: (ing: Ingredient) => void;
  onRemove: (ing: Ingredient) => void;
  onHint?: (msg: string) => void;
}) {
  const items = usePantryStore((s) => s.items);
  const flagIngredient = usePantryStore((s) => s.flagIngredient);
  const toggleStaple = usePantryStore((s) => s.toggleStaple);
  const [mode, setMode] = useState<'menu' | 'edit' | 'confirmRemove'>('menu');

  // Fresh menu every time a different row opens the sheet.
  useEffect(() => {
    setMode('menu');
  }, [ingredient?.id]);

  const row = ingredient ? pantryRowFor(ingredient, items) : undefined;
  const status: PantryStatus = row?.status ?? 'fine';
  const visible = !!ingredient;

  const setStatus = async (s: PantryStatus) => {
    if (!ingredient) return;
    const touched = await flagIngredient(ingredient.canonicalName, s);
    onHint?.(
      s === 'fine'
        ? `${touched.canonicalName}: have it.`
        : s === 'low'
          ? `${touched.canonicalName} running low · on the shopping list.`
          : `${touched.canonicalName} out · on the shopping list.`,
    );
    onClose();
  };

  return (
    <Overlay visible={visible} onClose={onClose}>
      {ingredient ? (
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Heading variant="recipeTitle" numberOfLines={2}>
              {ingredient.canonicalName}
            </Heading>
            <Text color="textMuted" numberOfLines={1}>
              {formatAmount(ingredient.amount, ingredient.unit) || 'no amount'}
              {row ? `  ·  in pantry${row.isStaple ? ' · always have' : ''}` : '  ·  not in pantry'}
            </Text>
          </View>

          {mode === 'menu' ? (
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              <SectionLabel color="textMuted">Pantry</SectionLabel>
              <View style={styles.statusRow}>
                {(['fine', 'low', 'out'] as PantryStatus[]).map((s) => {
                  const active = status === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => void setStatus(s)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Mark ${STATUS_LABEL[s].toLowerCase()}`}
                      style={[
                        styles.statusBtn,
                        active && (s === 'fine' ? styles.statusBtnFine : styles.statusBtnActive),
                      ]}>
                      <Text
                        variant="bodyStrong"
                        color={active ? 'bg' : 'text'}
                        style={styles.statusLabel}>
                        {STATUS_LABEL[s]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text color="textFaint" style={styles.statusHint}>
                {status === 'fine'
                  ? 'Low or Out puts it on the shopping list as a restock.'
                  : status === 'low'
                    ? 'On the shopping list. Tap Have it once you restock.'
                    : 'On the shopping list and locked as needed. Tap Have it once you restock.'}
              </Text>

              {row ? (
                <MenuItem
                  label={row.isStaple ? 'Remove always-have' : 'Mark as always-have'}
                  hint={
                    row.isStaple
                      ? 'Will show on shopping lists again like a regular item.'
                      : 'Assumed on hand; hidden from shopping lists unless low or out.'
                  }
                  onPress={async () => {
                    await toggleStaple(row.id);
                    onHint?.(
                      row.isStaple
                        ? `${row.canonicalName} is no longer always-have.`
                        : `${row.canonicalName} marked always-have.`,
                    );
                    onClose();
                  }}
                />
              ) : null}

              <SectionLabel color="textMuted" style={styles.sectionGap}>
                Recipe
              </SectionLabel>
              <MenuItem
                label="Sub"
                hint="Three ranked swaps with real amounts; accepting rewrites this line."
                onPress={() => onSub(ingredient)}
              />
              <MenuItem
                label="Edit"
                hint="Amount, unit or name. The original stays struck through."
                onPress={() => setMode('edit')}
              />
              <MenuItem
                label="Add to shopping list"
                hint={`One-off, for ${recipeTitle}. Not a pantry change.`}
                onPress={() => {
                  onAddToShopping(ingredient);
                  onClose();
                }}
              />
              <MenuItem
                label="Remove from recipe"
                tone="warn"
                onPress={() => setMode('confirmRemove')}
              />
            </ScrollView>
          ) : null}

          {mode === 'edit' ? (
            <EditForm
              ing={ingredient}
              onSave={(next) => {
                onEdit(ingredient, next);
                onClose();
              }}
              onCancel={() => setMode('menu')}
            />
          ) : null}

          {mode === 'confirmRemove' ? (
            <View style={styles.confirm}>
              <Text>
                Remove <Text variant="bodyStrong">{ingredient.canonicalName}</Text> from this
                recipe? Steps that mention it keep their text.
              </Text>
              <View style={styles.confirmBtns}>
                <Button label="Cancel" variant="secondary" flex onPress={() => setMode('menu')} />
                <Button
                  label="Remove"
                  flex
                  onPress={() => {
                    onRemove(ingredient);
                    onClose();
                  }}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </Overlay>
  );
}

function MenuItem({
  label,
  hint,
  tone = 'text',
  onPress,
}: {
  label: string;
  hint?: string;
  tone?: 'text' | 'warn';
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={styles.menuItem}
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Text variant="bodyStrong" color={tone}>
        {label}
      </Text>
      {hint ? (
        <Text color="textFaint" style={styles.menuHint}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

function EditForm({
  ing,
  onSave,
  onCancel,
}: {
  ing: Ingredient;
  onSave: (next: IngredientEdit) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(ing.amount != null ? String(ing.amount) : '');
  const [unit, setUnit] = useState(ing.unit ?? '');
  const [name, setName] = useState(ing.canonicalName);
  const submit = () => {
    const parsed = parseAmount(amount);
    onSave({
      amount: parsed,
      unit: (unit.trim() || null) as Unit | null,
      name: name.trim() || ing.canonicalName,
    });
  };
  return (
    <View style={styles.edit}>
      <View style={styles.editRow}>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="amt"
          placeholderTextColor={colors.textFaint}
          style={[styles.field, styles.fieldNum]}
          accessibilityLabel="Amount"
          autoFocus
        />
        <TextInput
          value={unit}
          onChangeText={setUnit}
          placeholder="unit"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          style={[styles.field, styles.fieldUnit]}
          accessibilityLabel="Unit"
        />
      </View>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="ingredient"
        placeholderTextColor={colors.textFaint}
        style={styles.field}
        accessibilityLabel="Ingredient name"
        onSubmitEditing={submit}
      />
      <Numeric color="textFaint" style={styles.editPreview}>
        {formatAmount(parseAmount(amount), (unit.trim() || null) as Unit | null) || '—'}{' '}
        <Text color="textFaint">{name.trim() || ing.canonicalName}</Text>
      </Numeric>
      <View style={styles.confirmBtns}>
        <Button label="Cancel" variant="secondary" flex onPress={onCancel} />
        <Button label="Save" glyph="done" flex onPress={submit} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 12, paddingBottom: 8 },
  head: { gap: 2, paddingRight: 28 },
  statusRow: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  statusBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
    alignItems: 'center',
  },
  // Flame is for actions; Have-it is the calm state, so it fills navy instead.
  statusBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  statusBtnFine: { backgroundColor: colors.text, borderColor: colors.text },
  statusLabel: { fontSize: 14 },
  statusHint: { fontSize: 12, fontStyle: 'italic', paddingTop: 8, lineHeight: 17 },
  sectionGap: { paddingTop: 16 },
  menuItem: {
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: 2,
  },
  menuHint: { fontSize: 12, fontStyle: 'italic', lineHeight: 16 },
  confirm: { gap: 16, paddingTop: 4 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  edit: { gap: 10 },
  editRow: { flexDirection: 'row', gap: 10 },
  field: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    color: colors.text,
  },
  fieldNum: { flex: 1 },
  fieldUnit: { flex: 1 },
  editPreview: { paddingVertical: 2 },
});
