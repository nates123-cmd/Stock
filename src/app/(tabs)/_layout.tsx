import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { Glyph } from '@/components';
import { colors, fonts, type GlyphName } from '@/design';

/**
 * Five-pillar bottom nav — spec §3. Plan is the default tab; the other four
 * are siblings. Active state in --accent, 10px uppercase labels, glyph icons
 * (no emoji, no icon fonts — spec §2).
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
      {/* Pipeline and Plan swapped positions per request (patch #97acc710):
          Pipeline now sits in the leftmost slot, Plan takes Pipeline's old
          3rd slot. `index` is still the Plan route so it remains the default
          landing screen — only the bar position changed. */}
      <Tabs.Screen
        name="pipeline"
        options={{
          title: 'Pipeline',
          tabBarIcon: ({ focused }) => <TabGlyph name="pipeline" focused={focused} />,
        }}
      />
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
        name="bench"
        options={{
          title: 'Bench',
          tabBarIcon: ({ focused }) => <TabGlyph name="bench" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="pantry"
        options={{
          title: 'Pantry',
          tabBarIcon: ({ focused }) => <TabGlyph name="pantry" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
