import { Button, Card } from '@suskii/ui-native';
import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { appConfig, setHostedServer } from '../config';
import { discoverHostedServer } from '../lib/hosted-server';
import { useT } from '../providers/app-provider';

/**
 * Says why prices and Cars are missing when the API cannot be reached, with a way to fix it. The
 * test build (variant `e2e`) explains how to start the online test server (ADR-066) and looks for
 * it again on Try again; it also points to Account, Test server for a stack on the tester's own
 * computer (ADR-054).
 */
export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const testBuild = appConfig.variant === 'e2e';
  const hosted = testBuild && appConfig.testServerDiscoveryUrl !== '' && !appConfig.customServer;

  const retry = async () => {
    if (hosted) {
      setChecking(true);
      // A newly started server has a new address; the app then reconnects there.
      setHostedServer(await discoverHostedServer(appConfig.testServerDiscoveryUrl));
      setChecking(false);
    }
    onRetry();
  };

  return (
    <Card testID="server-unreachable" className="gap-3 p-4">
      <Text accessibilityRole="alert" className="font-body text-body text-foreground">
        {t('mobile.home.unreachable')}
      </Text>
      {testBuild ? (
        <Text className="font-body text-body-sm text-foreground">
          {t(hosted ? 'mobile.home.unreachableHosted' : 'mobile.home.unreachableTestBuild')}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          testID="server-retry"
          variant="secondary"
          loading={checking}
          onPress={() => void retry()}
        >
          {t('mobile.retry')}
        </Button>
        {hosted && appConfig.testServerStartUrl.startsWith('https://') ? (
          <Button
            testID="server-start-test-server"
            variant="ghost"
            onPress={() => void openBrowserAsync(appConfig.testServerStartUrl)}
          >
            {t('mobile.home.startTestServer')}
          </Button>
        ) : null}
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
