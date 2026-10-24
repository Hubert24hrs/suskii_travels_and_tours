import { Button, Card, Input, useToast } from '@suskii/ui-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { appConfig } from '../../config';
import { testServer } from '../../lib/test-server';
import { useT } from '../../providers/app-provider';

/**
 * Test builds only (ADR-054): where the app sends its requests, and a way to point it at a stack
 * on the tester's own computer. The choice applies the next time the app starts.
 */
export function TestServerCard() {
  const { t } = useT();
  const { toast } = useToast();
  const [api, setApi] = useState(appConfig.apiBaseUrl);
  const [web, setWeb] = useState(appConfig.webBaseUrl);
  const [invalid, setInvalid] = useState<readonly ('api' | 'web')[]>([]);

  if (appConfig.variant !== 'e2e') return null;

  const save = () => {
    const result = testServer.save({ api, web });
    if (!result.ok) {
      setInvalid(result.invalid);
      return;
    }
    setInvalid([]);
    toast({ title: t('mobile.account.testServer.saved'), variant: 'success' });
  };

  const reset = () => {
    testServer.clear();
    setInvalid([]);
    toast({ title: t('mobile.account.testServer.saved'), variant: 'success' });
  };

  return (
    <Card testID="test-server" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('mobile.account.testServer.heading')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('mobile.account.testServer.intro')}
      </Text>
      <Text testID="test-server-in-use" className="font-body text-caption text-muted">
        {t('mobile.account.testServer.inUse', { api: appConfig.apiBaseUrl })}
      </Text>
      <Input
        testID="test-server-api"
        label={t('mobile.account.testServer.api')}
        value={api}
        onChangeText={setApi}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        error={invalid.includes('api') ? t('mobile.account.testServer.invalid') : undefined}
      />
      <Input
        testID="test-server-web"
        label={t('mobile.account.testServer.web')}
        value={web}
        onChangeText={setWeb}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        error={invalid.includes('web') ? t('mobile.account.testServer.invalid') : undefined}
      />
      <Button testID="test-server-save" onPress={save}>
        {t('mobile.account.testServer.save')}
      </Button>
      {appConfig.customServer ? (
        <Button testID="test-server-reset" variant="ghost" onPress={reset}>
          {t('mobile.account.testServer.reset')}
        </Button>
      ) : null}
    </Card>
  );
}
