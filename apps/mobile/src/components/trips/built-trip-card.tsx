import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { tripTitle } from '@suskii/shared';
import { Badge, Card } from '@suskii/ui-native';
import { Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

/** Badge colours for a combined trip's state. */
export const TRIP_STATE_VARIANT = {
  empty: 'neutral',
  open: 'info',
  awaiting_payment: 'warning',
  paid: 'success',
  closed: 'neutral',
} as const;

/**
 * A combined trip (ADR-099) in a list: where and when, how many parts, its state and its total.
 * Pressing it opens the trip's screen, which holds its parts, its payment and, once paid, its
 * receipt.
 */
export function BuiltTripCard({ trip, onPress }: { trip: Schemas['Trip']; onPress: () => void }) {
  const { t } = useT();
  const format = useFormatters();
  const live = trip.parts.filter((part) => part.state !== 'closed').length;
  const title = t('trips.route', tripTitle(trip.plan));
  return (
    <View testID="built-trip-card">
      <Card
        onPress={onPress}
        accessibilityLabel={`${title}, ${trip.reference}`}
        className="gap-2 p-4"
      >
        <Text className="font-heading text-h4 text-heading">{title}</Text>
        <Text className="font-body text-body-sm text-foreground">
          {format.dateRange(trip.plan.departDate, trip.plan.returnDate, 'medium')}
          {' · '}
          {live > 0 ? t('trips.list.parts', { count: live }) : t('trips.list.none')}
        </Text>
        <View className="flex-row items-center justify-between gap-3">
          <Badge variant={TRIP_STATE_VARIANT[trip.state]}>{t(`trips.states.${trip.state}`)}</Badge>
          {trip.total.amountMinor > 0 ? (
            <Text className="font-body-bold text-body text-heading">
              {format.money(trip.total)}
            </Text>
          ) : null}
        </View>
      </Card>
    </View>
  );
}
