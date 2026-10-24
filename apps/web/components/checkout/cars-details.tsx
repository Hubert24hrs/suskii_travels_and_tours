'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge } from '@suskii/ui-web';
import type { ReactNode } from 'react';

import type { Schemas } from '../../lib/browser-api';
import { useHydrated } from '../../lib/use-hydrated';

import { useBookingT } from './checkout-messages';
import { CancellationTiers } from './inhouse-details';

/** The Cars items of a quote or a booking (ADR-049): at most one is set. */
export type CarsItems = Pick<Schemas['Quote'], 'bus' | 'ride' | 'rental'>;

export const hasCarsItem = (items: CarsItems): boolean =>
  Boolean(items.bus ?? items.ride ?? items.rental);

const wall = (local: string): string => local.slice(11, 16);

function Line({ children }: { children: ReactNode }) {
  return <p className="font-body text-body-sm text-foreground">{children}</p>;
}

/**
 * What was booked, for a bus, a ride or a rental: shown in the checkout summary and on the
 * booking page. Wall times come from the item (no zone conversion); instants in the visitor's
 * zone are shown once hydrated.
 */
export function CarsDetails({
  items,
  inCheckout = false,
}: {
  items: CarsItems;
  inCheckout?: boolean;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const hydrated = useHydrated();
  const { bus, ride, rental } = items;
  const sample = (bus ?? ride ?? rental)?.product.sample ?? false;

  return (
    <div className="flex flex-col gap-2" data-testid="cars-details">
      {sample ? (
        <Badge variant="neutral" className="self-start">
          {t('booking.inhouse.sample')}
        </Badge>
      ) : null}
      {bus ? (
        <>
          <p className="font-body text-body font-bold text-foreground">
            {t('booking.cars.bus.route', {
              origin: bus.origin.cityName,
              destination: bus.destination.cityName,
            })}
          </p>
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
          {inCheckout && hydrated ? (
            <p className="font-body text-caption text-warning-text">
              {t('booking.cars.bus.holdUntil', { time: format.dateTime(bus.holdExpiresAt) })}
            </p>
          ) : null}
          <CancellationTiers tiers={bus.cancellationPolicy} />
        </>
      ) : null}
      {ride ? (
        <>
          <p className="font-body text-body font-bold text-foreground">
            {t('booking.cars.ride.route', {
              pickup: ride.pickup.label,
              dropoff: ride.dropoff.label,
            })}
          </p>
          <Line>
            {ride.scheduledFor
              ? t('booking.cars.ride.scheduled', {
                  time: hydrated ? format.dateTime(ride.scheduledFor) : '',
                })
              : t('booking.cars.ride.now')}
          </Line>
          <Line>
            {t('booking.cars.ride.category', {
              category: t(`booking.cars.ride.categories.${ride.category}`),
            })}
          </Line>
          <Line>
            {t('booking.cars.ride.distance', {
              km: format.number(Math.round(ride.distanceMetres / 100) / 10),
              minutes: Math.max(1, Math.round(ride.durationSeconds / 60)),
            })}
          </Line>
          {ride.estimate === 'straight_line' ? (
            <p className="font-body text-caption text-muted">{t('booking.cars.ride.estimate')}</p>
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
          <p className="font-body text-body font-bold text-foreground">
            {t('booking.cars.rental.vehicle', {
              make: rental.vehicle.make,
              model: rental.vehicle.model,
              year: String(rental.vehicle.year),
            })}
          </p>
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
    </div>
  );
}
