import { Button, Card } from '@suskii/ui-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';
import { useAuth } from '../../providers/auth';

/**
 * Shown once signed in, when this phone can use fingerprint sign-in but has not turned it on
 * (ADR-067). Either choice moves on; turning it on asks for the fingerprint to store the key.
 */
export function FingerprintOffer({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { enableFingerprint } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await enableFingerprint(t('mobile.auth.fingerprint.savePrompt'));
      if (result === 'enabled' || result === 'unavailable') {
        onDone();
        return;
      }
      setError(
        result === 'reauth'
          ? t('mobile.auth.fingerprint.reauth')
          : t('mobile.auth.fingerprint.failed'),
      );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="fingerprint-offer" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('mobile.auth.fingerprint.offerTitle')}
      </Text>
      <Text className="font-body text-body text-foreground">
        {t('mobile.auth.fingerprint.offerBody')}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <View className="gap-2">
        <Button testID="fingerprint-enable" fullWidth loading={busy} onPress={() => void enable()}>
          {t('mobile.auth.fingerprint.enable')}
        </Button>
        <Button testID="fingerprint-not-now" variant="ghost" fullWidth onPress={onDone}>
          {t('mobile.auth.fingerprint.notNow')}
        </Button>
      </View>
    </Card>
  );
}
