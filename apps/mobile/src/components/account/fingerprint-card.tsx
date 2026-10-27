import { Button, Card, useToast } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';

import { biometrics } from '../../lib/biometric';
import { useT } from '../../providers/app-provider';
import { useAuth } from '../../providers/auth';

/** Account: fingerprint sign-in on this phone, on or off (ADR-067). */
export function FingerprintCard() {
  const { t } = useT();
  const { toast } = useToast();
  const { enableFingerprint, disableFingerprint } = useAuth();
  const available = useQuery({
    queryKey: ['device', 'biometrics'],
    staleTime: Infinity,
    queryFn: () => biometrics.available(),
  });
  const [enabled, setEnabled] = useState(() => biometrics.enabled());
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await disableFingerprint();
        setEnabled(false);
        return;
      }
      const result = await enableFingerprint(t('mobile.auth.fingerprint.savePrompt'));
      if (result === 'enabled') {
        setEnabled(true);
        toast({ title: t('mobile.auth.fingerprint.enabled'), variant: 'success' });
      } else {
        toast({
          title:
            result === 'reauth'
              ? t('mobile.auth.fingerprint.reauth')
              : result === 'unavailable'
                ? t('mobile.auth.fingerprint.unavailable')
                : t('mobile.auth.fingerprint.failed'),
          variant: 'error',
        });
      }
    } catch {
      toast({ title: t('mobile.networkError'), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="fingerprint-setting" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('mobile.auth.fingerprint.setting')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {available.data === false && !enabled
          ? t('mobile.auth.fingerprint.unavailable')
          : enabled
            ? t('mobile.auth.fingerprint.settingOn')
            : t('mobile.auth.fingerprint.settingOff')}
      </Text>
      {available.data || enabled ? (
        <Button
          testID="fingerprint-toggle"
          variant="secondary"
          loading={busy}
          onPress={() => void toggle()}
        >
          {enabled ? t('mobile.auth.fingerprint.turnOff') : t('mobile.auth.fingerprint.turnOn')}
        </Button>
      ) : null}
    </Card>
  );
}
