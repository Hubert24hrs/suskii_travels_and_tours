'use client';

import { useFormatters } from '@suskii/i18n/react';
import { FINAL_FLIGHT_STATES, type FlightState } from '@suskii/shared/lite';
import { Badge, Card } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, type Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

type Status = Schemas['FlightStatus'];
type Flight = Status['flights'][number];

/** The API caches a reading for two minutes; once a minute keeps the page close behind it. */
const POLL_MS = 60_000;

const VARIANT: Record<FlightState, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  scheduled: 'success',
  boarding: 'info',
  departed: 'info',
  landed: 'neutral',
  delayed: 'warning',
  cancelled: 'danger',
  diverted: 'danger',
};

const time = (local: string): string => local.slice(11, 16);
const followed = (flight: Flight): boolean => flight.checkedAt !== null;
const finished = (flight: Flight): boolean => FINAL_FLIGHT_STATES.includes(flight.state);

/**
 * Live status of a confirmed booking's flights (ADR-095): shown from the day before a flight
 * leaves, when the API starts following it, and refreshed once a minute while the page is in
 * view and a followed flight has not finished. Nothing renders before that or when live status
 * is off, so the booking page looks as it always did.
 */
export function FlightStatus({ bookingId }: { bookingId: string }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [loaded, setLoaded] = useState<{ bookingId: string; status: Status } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (): Promise<void> => {
      let again = true;
      if (document.visibilityState === 'visible') {
        try {
          const { data } = await browserApi().GET('/v1/bookings/{bookingId}/flight-status', {
            params: { path: { bookingId } },
            headers: bookingHeaders(bookingId),
          });
          if (cancelled) return;
          if (data) {
            setLoaded({ bookingId, status: data });
            // Nothing to wait for: status is off, no flight is followed yet, or all have ended.
            again =
              data.live && data.flights.some((flight) => followed(flight) && !finished(flight));
          }
        } catch {
          // A failed read keeps what is shown; the next one may succeed.
        }
      }
      if (!cancelled && again) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bookingId]);

  const status = loaded?.bookingId === bookingId ? loaded.status : null;
  const flights = status?.live ? status.flights.filter(followed) : [];
  if (flights.length === 0) return null;

  const duration = (minutes: number): string =>
    minutes < 60
      ? t('booking.flightStatus.minutes', { minutes })
      : t('booking.flightStatus.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  /** The time, with its day when that is not the scheduled day. */
  const moment = (local: string, scheduled: string): string =>
    local.slice(0, 10) === scheduled.slice(0, 10)
      ? time(local)
      : `${time(local)}, ${format.date(local.slice(0, 10), 'weekday')}`;
  const updated = flights.reduce((latest, flight) =>
    (flight.checkedAt ?? '') > (latest.checkedAt ?? '') ? flight : latest,
  ).checkedAt;

  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="flight-status-title" data-testid="flight-status">
        <h2 id="flight-status-title" className="font-heading text-h3 font-bold text-heading">
          {t('booking.flightStatus.heading')}
        </h2>
        <ul className="flex flex-col gap-4" aria-live="polite">
          {flights.map((flight) => {
            const departure = flight.estimatedDepartureLocal ?? flight.scheduledDepartureLocal;
            const arrival = flight.estimatedArrivalLocal ?? flight.scheduledArrivalLocal;
            const places = [
              flight.departureTerminal
                ? t('booking.flightStatus.terminal', { terminal: flight.departureTerminal })
                : null,
              flight.departureGate
                ? t('booking.flightStatus.gate', { gate: flight.departureGate })
                : null,
              flight.state === 'landed' && flight.baggageBelt
                ? t('booking.flightStatus.belt', { belt: flight.baggageBelt })
                : null,
            ].filter((entry): entry is string => entry !== null);
            const gone = flight.state === 'cancelled' || flight.state === 'diverted';
            return (
              <li
                key={flight.flight}
                className="flex flex-col gap-1"
                data-testid={`flight-status-${flight.flight}`}
              >
                <p className="flex flex-wrap items-center gap-2 font-body text-body font-bold text-foreground">
                  {t('booking.flightStatus.flight', {
                    flight: `${flight.carrier.code} ${flight.flightNumber}`,
                    origin: flight.origin.code,
                    destination: flight.destination.code,
                  })}
                  <Badge variant={VARIANT[flight.state]} data-testid="flight-state">
                    {t(`booking.flightStatus.states.${flight.state}`)}
                  </Badge>
                </p>
                {gone ? null : (
                  <dl className="flex flex-col gap-1 font-body text-body-sm text-foreground">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-bold">{t('booking.flightStatus.departure')}</dt>
                      <dd data-testid="flight-departure">
                        {flight.delayMinutes > 0
                          ? `${t('booking.flightStatus.expected', {
                              time: moment(departure, flight.scheduledDepartureLocal),
                            })} · ${t('booking.flightStatus.late', {
                              duration: duration(flight.delayMinutes),
                            })} · ${t('booking.flightStatus.scheduled', {
                              time: time(flight.scheduledDepartureLocal),
                            })}`
                          : time(departure)}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-bold">{t('booking.flightStatus.arrival')}</dt>
                      <dd>{moment(arrival, flight.scheduledArrivalLocal)}</dd>
                    </div>
                  </dl>
                )}
                {places.length > 0 && !gone ? (
                  <p className="font-body text-body-sm text-foreground" data-testid="flight-gate">
                    {places.join(' · ')}
                  </p>
                ) : null}
                {flight.state === 'cancelled' ? (
                  <p className="font-body text-body-sm text-foreground">
                    {t('booking.flightStatus.cancelledHelp')}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="font-body text-caption text-foreground">
          {updated
            ? `${t('booking.flightStatus.updated', { time: format.dateTime(updated) })} · `
            : ''}
          {t('booking.flightStatus.note')}
        </p>
      </section>
    </Card>
  );
}
