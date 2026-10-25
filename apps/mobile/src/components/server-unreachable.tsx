import { Button, Card } from '@suskii/ui-native';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { appConfig } from '../config';
import { useT } from '../providers/app-provider';

/**
 * Says why prices and Cars are missing when the API cannot be reached, with a way to fix it. The
 * test build (variant `e2e`, ADR-054) also points to Account, Test server: its default API is the
 * computer that built it, which a phone cannot reach.
 */
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const testBuild = appConfig.variant === 'e2e';
  return (
    <Card testID="server-unreachable" className="gap-3 p-4">
      <Text accessibilityRole="alert" className="font-body text-body text-foreground">
        {t('mobile.home.unreachable')}
      </Text>
      {testBuild ? (
        <Text className="font-body text-body-sm text-foreground">
          {t('mobile.home.unreachableTestBuild')}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button testID="server-retry" variant="secondary" onPress={onRetry}>
          {t('mobile.retry')}
        </Button>
        {testBuild ? (
          <Button
            testID="server-set-test-server"
            variant="ghost"
            onPress={() => router.push('/account')}
          >
            {t('mobile.home.setTestServer')}
          </Button>
        ) : null}
      </View>
    </Card>
  );
}
