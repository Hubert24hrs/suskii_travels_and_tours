'use client';

import { useFormatters } from '@suskii/i18n/react';
import { tripTitle } from '@suskii/shared/lite';
import { Badge, Button } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';
import { saveTripReceipt } from '../trips/trip-receipt';
import { TRIP_STATE_VARIANT } from '../trips/trip-states';

import { useAccountT } from './account-messages';
import { AccountCard, ErrorLine } from './account-shell';

type Trip = Schemas['Trip'];

/**
 * The account's combined trips (ADR-099), newest first: each opens its trip page, and a paid one
 * gives its receipt here as well. Shown only once the account has one; every part is also listed
 * under Trips as a booking of its own, with its tickets or voucher.
 */
export function CombinedTripsSection() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/me/trips')
      .then(({ data }) => {
        if (!cancelled && data) setTrips(data.trips);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!trips || trips.length === 0) return null;

  const save = async (trip: Trip) => {
    setBusy(trip.id);
    setError(null);
    if (!(await saveTripReceipt(trip))) setError(t('trips.receipt.failed'));
    setBusy(null);
  };

  return (
    <AccountCard
      heading={t('account.trips.combinedHeading')}
      intro={t('account.trips.combinedIntro')}
      testId="account-combined-trips"
    >
      <ErrorLine message={error} />
      <ul className="flex flex-col divide-y divide-border">
        {trips.map((trip) => (
          <li
            key={trip.id}
            data-testid={`account-combined-trip-${trip.reference}`}
            className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-col gap-1">
              <AppLink
                href={`/trips/${trip.id}`}
                className="inline-flex min-h-6 items-center self-start font-body text-body font-bold text-primary underline focus-visible:focus-ring"
                aria-label={t('account.trips.open', { reference: trip.reference })}
              >
                {t('trips.route', tripTitle(trip.plan))}
              </AppLink>
              <p className="font-body text-body-sm text-muted" suppressHydrationWarning>
                {trip.reference}
                {' · '}
                {format.dateRange(trip.plan.departDate, trip.plan.returnDate)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={TRIP_STATE_VARIANT[trip.state]}>
                {t(`trips.states.${trip.state}`)}
              </Badge>
              {trip.total.amountMinor > 0 ? (
                <span className="font-body text-body-sm text-foreground">
                  {format.money(trip.total)}
                </span>
              ) : null}
              {trip.receipt ? (
                <Button
                  variant="ghost"
                  loading={busy === trip.id}
                  onClick={() => void save(trip)}
                  aria-label={t('trips.receipt.downloadLabel', { reference: trip.reference })}
                  data-testid={`account-trip-receipt-${trip.reference}`}
                >
                  {t('trips.receipt.heading')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </AccountCard>
  );
}
