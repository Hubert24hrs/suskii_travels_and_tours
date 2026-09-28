import { BRAND } from '@suskii/shared';
import { Stack } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Unstyled on purpose: NativeWind and design tokens arrive in phase 1, the real
// home screen (search card, tabs, deals) in phase 7.
export default function HomeScreen() {
  return (
    <SafeAreaView>
      <Stack.Screen options={{ title: BRAND.shortName }} />
      <Text accessibilityRole="header">{BRAND.shortName}</Text>
    </SafeAreaView>
  );
}
