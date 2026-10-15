import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Heading, Text } from './Text';
import { colors } from '@/design';

/**
 * A per-route error surface. Routes export this as their `ErrorBoundary` so a
 * render error inside a recipe or a cook stays ON that screen: the root
 * boundary in app/_layout catches the same error, but its retry remounts the
 * whole router, which lands on the tabs home and throws you out of whatever
 * you were looking at. Here, retry re-renders this route in place, and the
 * explicit "back" link is the way out when retrying keeps failing.
 */
export function RouteError({
  error,
  retry,
  backLabel,
  backTo,
}: {
  error: Error;
  retry: () => void;
  backLabel: string;
  backTo: string;
}) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.body}>
        <Heading variant="screenTitle">Stock hit an error</Heading>
        <Text color="textMuted">{String(error?.message ?? error)}</Text>
        <Pressable onPress={retry} hitSlop={12}>
          <Text color="accent">Tap to retry</Text>
        </Pressable>
        <Pressable onPress={() => router.replace(backTo as never)} hitSlop={12}>
          <Text color="textMuted">{backLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
});
