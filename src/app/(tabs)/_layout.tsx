import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { Glyph, GlobalCapture } from '@/components';
import { colors, fonts, type GlyphName } from '@/design';

/**
 * Three-tab bottom nav (redesign) — Recipes · Plan (index) · Cook. Pipeline,
 * Bench and Pantry stay as routes but are hidden from the bar (href:null),
 * reached from the new segmented headers and the Cook launcher. A single
 * global capture FAB floats over every tab, mounted outside <Tabs>.
 * Active state in --accent, 10px uppercase labels, glyph icons (no emoji,
 * no icon fonts — spec §2).
 */
function TabGlyph({ name, focused }: { name: GlyphName; focused: boolean }) {
  return <Glyph name={name} size={22} color={focused ? 'accent' : 'textMuted'} />;
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
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.bg2,
            borderTopColor: colors.line,
            height: 56 + bottomInset,
            paddingTop: 6,
            paddingBottom: bottomInset,
          },
          tabBarLabelStyle: {
            fontFamily: fonts.sans,
            fontSize: 10,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          },
        }}>
        {/* Visible: Recipes · Plan (index) · Cook. */}
        <Tabs.Screen
          name="recipes"
          options={{
            title: 'Recipes',
            tabBarIcon: ({ focused }) => <TabGlyph name="recipes" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="index"
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

      <GlobalCapture />
    </>
  );
}
