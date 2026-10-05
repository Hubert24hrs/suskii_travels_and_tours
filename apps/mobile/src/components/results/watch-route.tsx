import { color } from '@suskii/design-tokens';
import type { CurrencyCode, FlightSearchRequest } from '@suskii/shared';
import { Button, iconSize } from '@suskii/ui-native';
import { useRouter } from 'expo-router';
import { BellPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { problemSlug } from '../../lib/api';
import { useApp, useT } from '../../providers/app-provider';

type Outcome = 'watching' | 'exists' | 'limit' | 'error';

/**
 * "Watch this route" (ADR-032): a price alert for the first flight of the search, at its date,
 * cabin and currency. Visitors are offered sign-in first.
 */
export function WatchRoute({
  request,
  currency,
}: {
  request: FlightSearchRequest;
  currency: CurrencyCode;
}) {
  const { api, user } = useApp();
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const slice = request.slices[0];
  if (!slice) return null;

  if (!user) {
    return (
      <View className="items-start">
        <Button
          variant="ghost"
          testID="watch-route-sign-in"
          onPress={() => router.push('/sign-in')}
        >
          {t('alerts.signIn')}
        </Button>
      </View>
    );
  }

  const watch = async () => {
    setBusy(true);
    try {
      const { response, error } = await api.POST('/v1/me/price-alerts', {
        body: {
          origin: slice.origin,
          destination: slice.destination,
          departureDate: slice.departureDate,
          cabinClass: request.cabinClass,
          currency,
        },
      });
      const slug = problemSlug(error);
      setOutcome(
        response.ok
          ? 'watching'
          : slug === 'price-alert-exists'
            ? 'exists'
            : slug === 'price-alert-limit'
              ? 'limit'
              : 'error',
      );
    } catch {
      setOutcome('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="items-start gap-2">
      {outcome === 'watching' || outcome === 'exists' ? null : (
        <Button
          testID="watch-route"
          variant="ghost"
          loading={busy}
          onPress={() => void watch()}
          icon={<BellPlus color={color.primary} size={iconSize.sm} />}
        >
          {t('alerts.watch')}
        </Button>
      )}
      {outcome ? (
        <Text
          accessibilityLiveRegion="polite"
          className={
            outcome === 'watching' || outcome === 'exists'
              ? 'font-body text-body-sm text-success'
              : 'font-body text-body-sm text-danger'
          }
        >
          {t(`alerts.${outcome}`)}
        </Text>
      ) : null}
    </View>
  );
}
