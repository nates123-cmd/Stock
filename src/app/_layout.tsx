import '../../global.css';

import { useEffect } from 'react';
import { DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { colors } from '@/design';
import { CartFillBanner } from '@/components';
import { useRecipeStore } from '@/store/recipes';
import { usePlanStore } from '@/store/plan';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';
import { useCookStore } from '@/store/cooks';
import { useCookPlanStore } from '@/store/cookPlans';
import { useAuthStore } from '@/store/auth';
import { useHaveStore } from '@/store/have';
import { useExtrasStore } from '@/store/extras';
import { useShopMetaStore } from '@/store/shopMeta';
import { usePrefsStore } from '@/store/prefs';
import { useSynonymsStore } from '@/store/synonyms';
import { useCartFillStore } from '@/store/cartFill';
// Side-effect import: cloud sync wires itself to auth-state changes the
// moment this module loads. No-op when SUPABASE_* env vars are unset.
import '@/lib/sync';

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
  const hydrateCooks = useCookStore((s) => s.hydrate);
  const hydrateCookPlans = useCookPlanStore((s) => s.hydrate);
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const hydrateHave = useHaveStore((s) => s.hydrate);
  const hydrateExtras = useExtrasStore((s) => s.hydrate);
  const hydrateShopMeta = useShopMetaStore((s) => s.hydrate);
  const hydratePrefs = usePrefsStore((s) => s.hydrate);
  const hydrateSynonyms = useSynonymsStore((s) => s.hydrate);
  const hydrateCartFill = useCartFillStore((s) => s.hydrate);
  useEffect(() => {
    // Hydrate the local-first stores: native = SQLite (+ seed first run),
    // web = IndexedDB (+ seed first run) — Stock is a real PWA, see
    // project_stock_is_a_pwa. hydrateAuth pulls the persisted Supabase
    // session and subscribes to auth changes; sync layer rides on top.
    hydrateRecipes();
    hydratePlan();
    hydratePantry();
    hydratePipeline();
    hydrateCooks();
    hydrateCookPlans();
    hydrateAuth();
    hydrateHave();
    hydrateExtras();
    hydrateShopMeta();
    hydratePrefs();
    hydrateSynonyms();
    hydrateCartFill();
  }, [
    hydrateRecipes,
    hydratePlan,
    hydratePantry,
    hydratePipeline,
    hydrateCooks,
    hydrateCookPlans,
    hydrateAuth,
    hydrateHave,
    hydrateExtras,
    hydrateShopMeta,
    hydratePrefs,
    hydrateSynonyms,
    hydrateCartFill,
  ]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
              name="cook/meal/[id]"
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
              name="shopping-confirm"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="build-list"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="sign-in"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen
              name="idea-capture"
              options={{ headerShown: false, presentation: 'modal' }}
            />
            <Stack.Screen name="idea/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="cook-plan/[id]" options={{ headerShown: false }} />
            <Stack.Screen
              name="cook-plan/run/[id]"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="cook-plan-capture"
              options={{ headerShown: false, presentation: 'modal' }}
            />
          </Stack>
          {/* Cart-fill status — mounted at the ROOT so the progress bar + result
              float over EVERY screen (tabs and modals), not just the tab bar. */}
          <CartFillBanner />
          <StatusBar style="dark" />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
