import { useRef, useState } from 'react';
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
import { Text, Heading, SectionLabel, Button, BottomActionBar } from '@/components';
import { colors, layout } from '@/design';
import { usePipelineStore } from '@/store/pipeline';

/**
 * Capture a Pipeline idea (spec §8) — just a title + note, no required
 * fields. Low-friction on purpose: the point is to get the half-thought out
 * of your head, not to structure it.
 */
export default function IdeaCapture() {
  const router = useRouter();
  const capture = usePipelineStore((s) => s.capture);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const noteRef = useRef<TextInput>(null);

  const close = () =>
    router.canGoBack() ? router.back() : router.replace('/pipeline');

  const save = async () => {
    if (title.trim() || note.trim()) await capture(title, note);
    close();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Heading variant="screenTitle">New idea</Heading>
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
            <SectionLabel color="textMuted">Idea</SectionLabel>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Pho from scratch, someday…"
              placeholderTextColor={colors.textFaint}
              style={styles.titleInput}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => noteRef.current?.focus()}
            />
          </View>

          <View style={styles.field}>
            <SectionLabel color="textMuted">Note</SectionLabel>
            <TextInput
              ref={noteRef}
              value={note}
              onChangeText={setNote}
              placeholder="What's the hook? Why keep it around?"
              placeholderTextColor={colors.textFaint}
              multiline
              style={[styles.titleInput, styles.noteInput]}
            />
          </View>

          <Text color="textFaint" style={styles.tip}>
            No pressure to flesh it out. Promote it when you cook it, or plan it
            as an experiment from the week plan.
          </Text>
        </ScrollView>

        <BottomActionBar>
          <Button label="Cancel" variant="secondary" flex onPress={close} />
          <Button
            label="Capture"
            glyph="add"
            flex
            disabled={!title.trim() && !note.trim()}
            onPress={save}
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
  noteInput: { minHeight: 100, textAlignVertical: 'top', fontSize: 15 },
  tip: { fontStyle: 'italic', lineHeight: 19 },
});
