'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { AccountCard, StatusLine } from './account-shell';

type Summary = Schemas['BookingSummary'];

/** "Lagos to Abuja", the hotel or the product: what the trip is, without traveller data. */
const tripTitle = (trip: Summary): string =>
  trip.flight
    ? `${trip.flight.origin.cityName ?? trip.flight.origin.code} → ${trip.flight.destination.cityName ?? trip.flight.destination.code}`
    : (trip.hotel?.name ?? trip.product?.title ?? trip.reference);
type Traveller = Schemas['Traveller'];

/** Trips booked with the account, newest first, with a "show more" cursor. */
export function TripsSection() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [trips, setTrips] = useState<Summary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/bookings', { params: { query: cursor ? { cursor } : {} } })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setTrips((previous) => [...(cursor ? (previous ?? []) : []), ...data.bookings]);
        setNext(data.nextCursor);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor]);

  return (
    <AccountCard heading={t('account.trips.heading')} testId="account-trips">
      {trips === null ? null : trips.length === 0 ? (
        <p className="font-body text-body text-muted">{t('account.trips.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {trips.map((trip) => (
            <li
              key={trip.id}
              className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <AppLink
                  href={`/bookings/${trip.id}`}
                  className="font-body text-body font-bold text-primary underline focus-visible:focus-ring"
                  aria-label={t('account.trips.open', { reference: trip.reference })}
                >
                  {tripTitle(trip)}
                </AppLink>
                <p className="font-body text-body-sm text-muted">
                  {trip.reference}
                  {trip.startsOn ? ` · ${format.date(trip.startsOn)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={trip.status === 'CONFIRMED' ? 'success' : 'neutral'}>
                  {t(`booking.status.${trip.status}`)}
                </Badge>
                <span className="font-body text-body-sm text-foreground">
                  {format.money(trip.total)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {next ? (
        <Button variant="ghost" className="self-start" onClick={() => setCursor(next)}>
          {t('account.trips.more')}
        </Button>
      ) : null}
    </AccountCard>
  );
}

/** Saved travellers (created at checkout); passports show only their last characters. */
export function TravellersSection() {
  const { t } = useAccountT();
  const format = useFormatters();
  const [travellers, setTravellers] = useState<Traveller[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/travellers')
      .then(({ data }) => {
        if (!cancelled && data) setTravellers(data.travellers);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = async (traveller: Traveller) => {
    const { response } = await browserApi().DELETE('/v1/me/travellers/{travellerId}', {
      params: { path: { travellerId: traveller.id } },
    });
    if (response.ok) {
      setTravellers((list) => (list ?? []).filter((item) => item.id !== traveller.id));
      setStatus(t('account.travellers.removed'));
    }
  };

  return (
    <AccountCard
      heading={t('account.travellers.heading')}
      intro={t('account.travellers.intro')}
      testId="account-travellers"
    >
      {travellers === null ? null : travellers.length === 0 ? (
        <p className="font-body text-body text-muted">{t('account.travellers.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {travellers.map((traveller) => {
            const name = `${traveller.givenNames} ${traveller.surname}`;
            return (
              <li key={traveller.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex flex-col gap-1">
                  <p className="font-body text-body font-bold text-foreground">{name}</p>
                  <p className="font-body text-body-sm text-muted">
                    {format.date(traveller.dateOfBirth)}
                    {traveller.document
                      ? ` · ${t('account.travellers.passport', { hint: traveller.document.hint })}`
                      : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  aria-label={t('account.travellers.remove', { name })}
                  onClick={() => void remove(traveller)}
                >
                  {t('account.remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <StatusLine message={status} />
    </AccountCard>
  );
}
