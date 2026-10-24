import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge } from '@suskii/ui-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { kilometres } from '../../lib/cars';
import { useT } from '../../providers/app-provider';
import { CancellationTiers } from '../inhouse/inhouse-summary';

/** The Cars items of a quote or a booking (ADR-049): at most one is set. */
export type CarsItems = Pick<Schemas['Quote'], 'bus' | 'ride' | 'rental'>;

export const hasCarsItem = (items: CarsItems): boolean =>
  Boolean(items.bus ?? items.ride ?? items.rental);

const wall = (local: string): string => local.slice(11, 16);

function Line({ children }: { children: ReactNode }) {
  return <Text className="font-body text-body-sm text-foreground">{children}</Text>;
}

/**
 * What was booked, for a bus, a ride or a rental: in the checkout summary and on the trip
 * screen. Wall times come from the item as they are (no zone conversion).
 */
export function CarsSummary({
  items,
  inCheckout = false,
}: {
  items: CarsItems;
  inCheckout?: boolean;
}) {
  const { t } = useT();
  const format = useFormatters();
  const { bus, ride, rental } = items;
  const item = bus ?? ride ?? rental;
  if (!item) return null;
  return (
    <View testID="cars-summary" className="gap-2">
      {item.product.sample ? (
        <View className="items-start">
          <Badge variant="neutral">{t('booking.inhouse.sample')}</Badge>
        </View>
      ) : null}
      {bus ? (
        <>
          <Text className="font-body-bold text-body text-foreground">
            {t('booking.cars.bus.route', {
              origin: bus.origin.cityName,
              destination: bus.destination.cityName,
            })}
          </Text>
          <Line>{t('booking.cars.bus.operator', { operator: bus.operatorName })}</Line>
          <Line>
            {format.date(bus.departsAtLocal.slice(0, 10), 'weekday')} ·{' '}
            {t('booking.cars.bus.departs', { time: wall(bus.departsAtLocal) })}
          </Line>
          <Line>
            {t('booking.cars.bus.terminal', { name: bus.origin.name, address: bus.origin.address })}
          </Line>
          <Line>
            {t('booking.cars.bus.seats', { count: bus.seats.length, seats: bus.seats.join(', ') })}
          </Line>
          {inCheckout ? (
            <Text className="font-body text-caption text-warning-text">
              {t('booking.cars.bus.holdUntil', { time: format.dateTime(bus.holdExpiresAt) })}
            </Text>
          ) : null}
          <CancellationTiers tiers={bus.cancellationPolicy} />
        </>
      ) : null}
      {ride ? (
        <>
          <Text className="font-body-bold text-body text-foreground">
            {t('booking.cars.ride.route', {
              pickup: ride.pickup.label,
              dropoff: ride.dropoff.label,
            })}
          </Text>
          <Line>
            {ride.scheduledFor
              ? t('booking.cars.ride.scheduled', { time: format.dateTime(ride.scheduledFor) })
              : t('booking.cars.ride.now')}
          </Line>
          <Line>
            {t('booking.cars.ride.category', {
              category: t(`booking.cars.ride.categories.${ride.category}`),
            })}
          </Line>
          <Line>
            {t('booking.cars.ride.distance', {
              km: format.number(kilometres(ride.distanceMetres)),
              minutes: Math.max(1, Math.round(ride.durationSeconds / 60)),
            })}
          </Line>
          {ride.estimate === 'straight_line' ? (
            <Text className="font-body text-caption text-muted">
              {t('booking.cars.ride.estimate')}
            </Text>
          ) : null}
          <Line>
            {t('booking.cars.ride.cancellation', {
              minutes: Math.round(ride.cancellation.freeCancelSeconds / 60),
              fee: format.money(ride.cancellation.fee),
            })}
          </Line>
        </>
      ) : null}
      {rental ? (
        <>
          <Text className="font-body-bold text-body text-foreground">
            {t('booking.cars.rental.vehicle', {
              make: rental.vehicle.make,
              model: rental.vehicle.model,
              year: String(rental.vehicle.year),
            })}
          </Text>
          <Line>
            {t('booking.cars.rental.period', {
              from: `${format.date(rental.pickupAtLocal.slice(0, 10), 'medium')} ${wall(rental.pickupAtLocal)}`,
              until: `${format.date(rental.returnAtLocal.slice(0, 10), 'medium')} ${wall(rental.returnAtLocal)}`,
              days: t('booking.cars.rental.days', { count: rental.days }),
            })}
          </Line>
          <Line>
            {rental.delivery
              ? t('booking.cars.rental.delivery', rental.delivery)
              : t('booking.cars.rental.branch', rental.branch)}
          </Line>
          <Line>
            {rental.chauffeur
              ? t('booking.cars.rental.chauffeur')
              : t('booking.cars.rental.selfDrive')}
          </Line>
          {rental.charge.deposit.amountMinor > 0 ? (
            <Line>
              {t('booking.cars.rental.deposit', { deposit: format.money(rental.charge.deposit) })}
            </Line>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
