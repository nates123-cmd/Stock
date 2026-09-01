/**
 * File a recipe into a folder.
 *
 * Folders are derived from the library (see lib/recipeFolders.ts), so there is
 * no "create folder" step to perform first: typing a new name and confirming
 * IS the creation. Existing names are offered as taps so the same folder does
 * not get re-typed three slightly different ways.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text, SectionLabel } from './Text';
import { Button } from './Button';
import { Glyph } from './Glyph';
import { Overlay } from './Overlay';
import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { allFolderNames, normalizeFolderName } from '@/lib/recipeFolders';

export function FolderPicker({
  current,
  onPick,
  onClose,
}: {
  /** The folder the recipe is in now, if any. */
  current: string | undefined;
  onPick: (folder: string | undefined) => void;
  onClose: () => void;
}) {
  const recipes = useRecipeStore((s) => s.recipes);
  const names = useMemo(() => allFolderNames(recipes), [recipes]);
  const [draft, setDraft] = useState('');

  const typed = normalizeFolderName(draft);
  // Only offer to create when the typed name isn't already a folder — the
  // existing row above already handles that case.
  const canCreate =
    !!typed && !names.some((n) => n.toLowerCase() === typed.toLowerCase());

  const isCurrent = (n: string) =>
    !!current && current.trim().toLowerCase() === n.toLowerCase();

  return (
    <Overlay visible onClose={onClose}>
      <View style={styles.sheet}>
        <SectionLabel color="textMuted">Move to folder</SectionLabel>

        <Pressable style={styles.row} onPress={() => onPick(undefined)}>
          <Text color={current ? 'text' : 'accent'}>Unfiled</Text>
          {!current && <Glyph name="done" size={16} color="accent" />}
        </Pressable>

        {names.map((n) => (
          <Pressable key={n} style={styles.row} onPress={() => onPick(n)}>
            <Text color={isCurrent(n) ? 'accent' : 'text'}>{n}</Text>
            {isCurrent(n) && <Glyph name="done" size={16} color="accent" />}
          </Pressable>
        ))}

        <View style={styles.newRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="New folder…"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={() => canCreate && typed && onPick(typed)}
          />
          <Button
            label="Create"
            variant="secondary"
            disabled={!canCreate}
            onPress={() => typed && onPick(typed)}
          />
        </View>
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 6, padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  newRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.bg3,
  },
});
