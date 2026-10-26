import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Button, Card } from '@suskii/ui-native';
import { Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

type Change = Schemas['FlightScheduleChange'];
type Slice = Change['previous'][number];

/**
 * An airline change to a ticketed flight (ADR-065): the booked and the new times side by side,
 * and Accept when the airline allows it online (never offline). Cancelling instead stays with
 * "Cancel flight" on the same screen.
 */
export function ScheduleChange({
  change,
  offline,
  busy,
  onAccept,
}: {
  change: Change;
  offline: boolean;
  busy: boolean;
  onAccept: () => void;
}) {
  const { t } = useT();
  const format = useFormatters();
  if (change.status !== 'open') return null;

  const times = (slice: Slice): string =>
    t('booking.scheduleChange.times', {
      flights: slice.segments
        .map((segment) => `${segment.marketingCarrier.code} ${segment.flightNumber}`)
        .join(', '),
      departure: `${format.date(slice.departureLocal.slice(0, 10), 'weekday')} ${slice.departureLocal.slice(11, 16)}`,
      arrival: `${format.date(slice.arrivalLocal.slice(0, 10), 'weekday')} ${slice.arrivalLocal.slice(11, 16)}`,
    });
  const rows = Math.max(change.previous.length, change.updated.length);

  return (
    <Card testID="schedule-change" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.scheduleChange.title')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('booking.scheduleChange.intro')}
      </Text>
      {Array.from({ length: rows }, (_, index) => {
        const before = change.previous[index];
        const after = change.updated[index];
        const route = before ?? after;
        if (!route) return null;
        return (
          <View key={index} className="gap-1">
            <Text className="font-body-bold text-body text-foreground">
              {route.origin.cityName ?? route.origin.code} ({route.origin.code}) →{' '}
              {route.destination.cityName ?? route.destination.code} ({route.destination.code})
            </Text>
            {before ? (
              <Text testID="schedule-change-was" className="font-body text-body-sm text-muted">
                {t('booking.scheduleChange.was')}: {times(before)}
              </Text>
            ) : null}
            <Text testID="schedule-change-now" className="font-body text-body-sm text-foreground">
              {t('booking.scheduleChange.now')}:{' '}
              {after ? times(after) : t('booking.scheduleChange.removed')}
            </Text>
          </View>
        );
      })}
      {change.acceptable ? (
        offline ? null : (
          <View className="gap-2">
            <Button testID="schedule-change-accept" loading={busy} onPress={onAccept}>
              {t('booking.scheduleChange.accept')}
            </Button>
            <Text className="font-body text-caption text-muted">
              {t('booking.scheduleChange.acceptHint')}
            </Text>
          </View>
        )
      ) : (
        <Text className="font-body text-body-sm text-foreground">
          {t('booking.scheduleChange.support')}
        </Text>
      )}
    </Card>
  );
}
