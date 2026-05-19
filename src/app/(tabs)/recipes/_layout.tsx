import { Stack } from 'expo-router';
import { colors } from '@/design';

/** Recipes pillar stack: library → detail (spec §6). Custom in-screen back
 * bars per spec, so native headers stay hidden. */
export default function RecipesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
