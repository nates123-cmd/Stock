import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { Glyph } from '@/components';
import { colors, fonts, type GlyphName } from '@/design';

/**
 * Recipes is the app's landing screen, so it is also the tab navigator's
 * anchor: a back gesture from anywhere in the tabs comes to rest here rather
 * than on a Plan screen the user never chose. The `/` route itself redirects
 * (see app/index.tsx) — this handles native's back stack, that handles the URL.
 */
export const unstable_settings = {
  anchor: 'recipes',
  initialRouteName: 'recipes',
};

/**
 * Three-tab bottom nav (redesign) — Recipes · Plan · Cook. Pipeline,
 * Bench and Pantry stay as routes but are hidden from the bar (href:null),
 * reached from the new segmented headers and the Cook launcher. The global
 * capture FAB is gone — the shopping list's inline "Add an item" row is the
 * capture surface now.
 * Enamel (DESIGN.md): ink label for the active tab, Flame only on its glyph,
 * 12px sentence-case labels matching the top tabs, glyph icons (no emoji, no icon fonts).
 */
function TabGlyph({ name, focused }: { name: GlyphName; focused: boolean }) {
  return <Glyph name={name} size={22} color={focused ? 'accent' : 'textFaint'} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  // Lift the bar off the bottom edge / iOS home indicator. On this web export
  // env(safe-area-inset-*) is 0 (no viewport-fit=cover), so floor the clearance
  // so the labels clear the home indicator instead of sitting under it.
  const bottomInset = Math.max(insets.bottom, 40);
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: {
            backgroundColor: colors.bg,
            borderTopColor: colors.line,
            height: 56 + bottomInset,
            paddingTop: 6,
            paddingBottom: bottomInset,
          },
          tabBarLabelStyle: {
            fontFamily: fonts.sans,
            // Same treatment as the top segmented tabs: Figtree semibold,
            // sentence case, no tracking.
            fontSize: 12,
            fontWeight: '600',
            letterSpacing: 0,
          },
        }}>
        {/* Visible: Recipes · Plan · Cook. */}
        <Tabs.Screen
          name="recipes"
          options={{
            title: 'Recipes',
            tabBarIcon: ({ focused }) => <TabGlyph name="recipes" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="plan"
          options={{
            title: 'Plan',
            tabBarIcon: ({ focused }) => <TabGlyph name="plan" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="cook"
          options={{
            title: 'Cook',
            tabBarIcon: ({ focused }) => <TabGlyph name="cook" focused={focused} />,
          }}
        />

        {/* Hidden routes (href:null) — kept mounted so deep links / the new
            segmented headers + Cook launcher can still reach them. */}
        <Tabs.Screen name="pipeline" options={{ href: null }} />
        <Tabs.Screen name="bench" options={{ href: null }} />
        <Tabs.Screen name="pantry" options={{ href: null }} />
      </Tabs>
    </>
  );
}
