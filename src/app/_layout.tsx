import '../../global.css';

import { useEffect } from 'react';
import { DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { usePlanStore } from '@/store/plan';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';

export const unstable_settings = {
  anchor: '(tabs)',
};

const queryClient = new QueryClient();

// Light-only navigation theme mapped to the parchment palette (spec §2/§12).
const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.line,
    notification: colors.accent,
  },
};

export default function RootLayout() {
  const hydrateRecipes = useRecipeStore((s) => s.hydrate);
  const hydratePlan = usePlanStore((s) => s.hydrate);
  const hydratePantry = usePantryStore((s) => s.hydrate);
  const hydratePipeline = usePipelineStore((s) => s.hydrate);
  useEffect(() => {
    // Hydrate the local-first stores (migrate + seed on native, seed on web).
    hydrateRecipes();
    hydratePlan();
    hydratePantry();
    hydratePipeline();
  }, [hydrateRecipes, hydratePlan, hydratePantry, hydratePipeline]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="capture"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="cook/[id]"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="plan-picker"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="shopping"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="pantry-paste"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="idea-capture"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen name="idea/[id]" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="dark" />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
