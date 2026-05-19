import { Tabs } from 'expo-router';

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
        },
        tabBarLabelStyle: {
          fontFamily: fonts.sans,
          fontSize: 10,
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
      }}>
      {/* Order is fixed by spec §3 — Plan first, default-selected. */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Plan',
          tabBarIcon: ({ focused }) => <TabGlyph name="plan" focused={focused} />,
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
        name="pipeline"
        options={{
          title: 'Pipeline',
          tabBarIcon: ({ focused }) => <TabGlyph name="pipeline" focused={focused} />,
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
