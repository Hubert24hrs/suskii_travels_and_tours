import { BRAND } from '@suskii/shared';
import { Card } from '@suskii/ui-native';
import { Text, View } from 'react-native';

/** Token-styled shell; the real home screen (search card, deals) is built in phase 7. */
export function HomeScreen() {
  return (
    <View className="flex-1 justify-center bg-background px-4">
      <Card className="p-6">
        <Text
          accessibilityRole="header"
          className="font-heading-extrabold text-hero-mobile text-heading"
        >
          {BRAND.shortName}
        </Text>
      </Card>
    </View>
  );
}
