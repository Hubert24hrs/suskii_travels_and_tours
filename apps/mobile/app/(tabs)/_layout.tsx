import { color } from '@suskii/design-tokens';
import { iconSize } from '@suskii/ui-native';
import { Tabs } from 'expo-router';
import { Crown, House, Luggage, Tag, UserRound } from 'lucide-react-native';
import type { ComponentType } from 'react';

import { useT } from '../../src/providers/app-provider';

type Icon = ComponentType<{ color?: string; size?: number }>;

function icon(Glyph: Icon) {
  function TabIcon({ focused }: { focused: boolean }) {
    return <Glyph color={focused ? color.primary : color.muted} size={iconSize.md} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const { t } = useT();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.muted,
        headerTitleAlign: 'center',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('mobile.tabs.home'),
          headerShown: false,
          tabBarIcon: icon(House),
          tabBarButtonTestID: 'tab-home',
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: t('mobile.tabs.trips'),
          tabBarIcon: icon(Luggage),
          tabBarButtonTestID: 'tab-trips',
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: t('mobile.tabs.deals'),
          tabBarIcon: icon(Tag),
          tabBarButtonTestID: 'tab-deals',
        }}
      />
      <Tabs.Screen
        name="prime"
        options={{
          title: t('mobile.tabs.prime'),
          tabBarIcon: icon(Crown),
          tabBarButtonTestID: 'tab-prime',
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('mobile.tabs.account'),
          tabBarIcon: icon(UserRound),
          tabBarButtonTestID: 'tab-account',
        }}
      />
    </Tabs>
  );
}
