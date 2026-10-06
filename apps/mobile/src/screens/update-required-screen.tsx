import { Button } from '@suskii/ui-native';
import { Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { storeUrl } from '../lib/app-update';
import { useT } from '../providers/app-provider';

/**
 * Shown instead of every other screen once the API has retired this app version (426,
 * MASVS-CODE-2). The only way on is the store listing; nothing here talks to the API.
 */
export function UpdateRequiredScreen() {
  const { t } = useT();
  const url = storeUrl();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View testID="update-required" className="flex-1 justify-center gap-4 p-6">
        <Text accessibilityRole="header" className="font-heading text-h2 text-heading">
          {t('mobile.update.title')}
        </Text>
        <Text className="font-body text-body text-foreground">{t('mobile.update.body')}</Text>
        {url ? (
          <Button
            testID="update-required-store"
            fullWidth
            onPress={() => void Linking.openURL(url)}
          >
            {t('mobile.update.action')}
          </Button>
        ) : (
          <Text className="font-body text-body text-muted">{t('mobile.update.noStore')}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}
