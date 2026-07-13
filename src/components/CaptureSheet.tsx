import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text, SectionLabel } from './Text';
import { Button } from './Button';
import { Overlay } from './Overlay';
import { colors, layout } from '@/design';
import { useExtrasStore } from '@/store/extras';
import { usePipelineStore } from '@/store/pipeline';

type Dest = 'shopping' | 'totry' | 'recipe';

const DESTS: { key: Dest; label: string }[] = [
  { key: 'shopping', label: 'Shopping' },
  { key: 'totry', label: 'Ideas' },
  { key: 'recipe', label: 'Recipe' },
];

/**
 * Global quick-capture sheet (redesign — the cart-+ FAB target). Type + enter,
 * done. Defaults to Shopping; the chip row redirects to Ideas or a new recipe.
 * Mounted once via GlobalCapture in (tabs)/_layout, not per-screen.
 */
export function CaptureSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const addExtras = useExtrasStore((s) => s.add);
  const capture = usePipelineStore((s) => s.capture);
  const [dest, setDest] = useState<Dest>('shopping');
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const reset = () => {
    setText('');
    setConfirm(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const value = text.trim();
    if (dest === 'recipe') {
      close();
      router.push('/capture' as never);
      return;
    }
    if (!value) return;
    if (dest === 'shopping') {
      addExtras([
        {
          canonicalName: value,
          amount: null,
          unit: null,
          originLabel: null,
          originId: null,
        },
      ]);
      setConfirm(`Added "${value}" to shopping`);
    } else {
      await capture(value, '', 'idea');
      setConfirm(`Saved "${value}" to Ideas`);
    }
    setText('');
  };

  return (
    <Overlay visible={visible} onClose={close} anchor="bottom">
      <View style={styles.sheet}>
        <SectionLabel>Quick capture</SectionLabel>

        <View style={styles.chips}>
          {DESTS.map((d) => {
            const active = d.key === dest;
            return (
              <Pressable
                key={d.key}
                onPress={() => {
                  setDest(d.key);
                  setConfirm(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}>
                <Text variant="bodyStrong" color={active ? 'bg' : 'textMuted'}>
                  {d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {dest === 'recipe' ? (
          <Button label="New recipe" glyph="add" onPress={submit} />
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={dest === 'shopping' ? 'Add to shopping…' : 'Something to try…'}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
            />
            <Button label="Add" glyph="add" onPress={submit} disabled={!text.trim()} />
          </View>
        )}

        {confirm ? (
          <Text color="ok" style={styles.confirm}>
            {confirm}
          </Text>
        ) : null}
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 12 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: layout.cardRadius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  confirm: { fontStyle: 'italic' },
});

export default CaptureSheet;
