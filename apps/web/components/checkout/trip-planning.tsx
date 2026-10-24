'use client';

import { useFormatters } from '@suskii/i18n/react';
import { isSupportedCurrency, type BookingStatus } from '@suskii/shared/lite';
import { Button, Card } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, type Schemas } from '../../lib/browser-api';
import { wallTime } from '../../lib/cars-query';
import { useAccount } from '../account/use-account';
import { AppLink } from '../app-link';
import { NativeSelect } from '../search/native-select';

import { useBookingT } from './checkout-messages';

type Booking = Schemas['Booking'];
type Place = Schemas['RidePlaces']['places'][number];
type Plan = Schemas['DeparturePlan'];
type Suggestions = Schemas['CarsSuggestions'];

/** Bookings that are going ahead: paid, being ticketed or confirmed, or on a payment plan. */
const GOING_AHEAD: readonly BookingStatus[] = [
  'PAID',
  'TICKETING',
  'CONFIRMED',
  'HELD',
  'PARTIALLY_PAID',
];

const LINK =
  'inline-flex min-h-12 items-center justify-center self-start rounded-md border border-border-strong bg-surface px-6 font-body text-body font-bold text-primary focus-visible:focus-ring';

/** The flight's or bus's departure: its city, the zone its times are shown in, and when. */
function departureOf(booking: Booking): { city: string; zone: string; departsAt: string } | null {
  const slice = booking.flight?.slices[0];
  if (slice) {
    return slice.origin.cityName
      ? { city: slice.origin.cityName, zone: slice.origin.timeZone, departsAt: slice.departureUtc }
      : null;
  }
  if (booking.bus) {
    return {
      city: booking.bus.origin.cityName,
      zone: booking.bus.timeZone,
      departsAt: booking.bus.departsAt,
    };
  }
  return null;
}

/**
 * Cars help on a booking that is going ahead (P9, flags `CARS_DEPARTURE_PLANNER` and
 * `CARS_BUNDLES`): when to leave for a flight or bus, with a ride booked for that time, and the
 * rides, cars and buses that fit the trip. Suggestions are prefilled searches only; nothing is
 * booked or held until the traveller checks out.
 */
export function TripPlanning({ booking }: { booking: Booking }) {
  const [features, setFeatures] = useState<Schemas['CarsFeatures'] | null>(null);
  const going = GOING_AHEAD.includes(booking.status);

  useEffect(() => {
    if (!going) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/cars/features')
      .then(({ data }) => {
        if (!cancelled && data) setFeatures(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [going]);

  if (!going || !features) return null;
  return (
    <>
      {features.departurePlanner && features.rides ? <DeparturePlanner booking={booking} /> : null}
      {features.bundles ? <TripSuggestions booking={booking} /> : null}
    </>
  );
}

function DeparturePlanner({ booking }: { booking: Booking }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const router = useRouter();
  const { phase } = useAccount();
  const departure = departureOf(booking);
  const city = departure?.city;
  const departsAt = departure?.departsAt;
  const [places, setPlaces] = useState<readonly Place[] | null>(null);
  const [from, setFrom] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!city || !departsAt) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/rides/places')
      .then(({ data }) => {
        // Nothing to plan once the flight or bus has left.
        if (cancelled || !data || Date.parse(departsAt) <= Date.now()) return;
        setPlaces(data.places.filter((place) => place.cityName === city));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [city, departsAt]);

  if (!departure || !places) return null;
  const zone = departure.zone;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!from) return;
    setError(null);
    setBusy(true);
    try {
      const { data, response } = await browserApi().GET('/v1/bookings/{bookingId}/departure-plan', {
        params: { path: { bookingId: booking.id }, query: { from } },
        headers: bookingHeaders(booking.id),
      });
      setPlan(data ?? null);
      if (!data) {
        setError(
          response.status === 422
            ? t('booking.cars.plan.errors.unavailable')
            : response.status === 429
              ? t('booking.cars.plan.errors.tooMany')
              : t('booking.cars.plan.errors.generic'),
        );
      }
    } catch {
      setError(t('booking.cars.plan.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const bookRide = async (ride: NonNullable<Plan['ride']>) => {
    setError(null);
    setBusy(true);
    try {
      const { data } = await browserApi().POST('/v1/inhouse-quotes', {
        body: {
          kind: 'ride',
          category: 'standard',
          pickup: ride.pickup,
          dropoff: ride.dropoff,
          scheduledFor: ride.scheduledFor,
          currency: isSupportedCurrency(booking.price.total.currency)
            ? booking.price.total.currency
            : undefined,
        },
      });
      if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      }
      setError(t('booking.cars.plan.errors.generic'));
    } catch {
      setError(t('booking.cars.plan.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const ride = plan?.ride ?? null;
  const options = [
    { value: '', label: t('booking.cars.plan.choose') },
    ...places.map((place) => ({ value: place.id, label: place.name })),
  ];

  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-departure-plan" data-testid="departure-plan">
        <h2 id="booking-departure-plan" className="font-heading text-h4 font-bold text-heading">
          {t('booking.cars.plan.heading')}
        </h2>
        {places.length === 0 ? (
          <p className="font-body text-body-sm text-foreground">
            {t('booking.cars.plan.noPlaces', { city: departure.city })}
          </p>
        ) : (
          <p className="font-body text-body-sm text-foreground">{t('booking.cars.plan.intro')}</p>
        )}
        {places.length === 0 ? null : (
          <form
            method="post"
            noValidate
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-3 md:flex-row md:items-end"
          >
            <NativeSelect
              id="plan-from"
              label={t('booking.cars.plan.from')}
              options={options}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPlan(null);
              }}
              className="md:flex-1"
            />
            <Button type="submit" variant="secondary" disabled={!from || busy}>
              {busy && !plan ? t('booking.cars.plan.working') : t('booking.cars.plan.submit')}
            </Button>
          </form>
        )}
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        {plan ? (
          <div className="flex flex-col gap-2" data-testid="plan-result">
            <p className="font-heading text-h3 font-bold text-heading" data-testid="plan-leave-by">
              {t('booking.cars.plan.leaveBy', { time: format.dateTime(plan.leaveBy, zone) })}
            </p>
            <p className="font-body text-body text-foreground">
              {t('booking.cars.plan.arriveBy', {
                place: plan.destination.label,
                time: format.dateTime(plan.arriveBy, zone),
              })}
            </p>
            <p className="font-body text-body-sm text-foreground">
              {t(`booking.cars.plan.buffer.${plan.kind}`, { minutes: plan.bufferMinutes })}{' '}
              {t('booking.cars.plan.travel', {
                minutes: Math.ceil(plan.travel.durationSeconds / 60),
                km: format.number(Math.round(plan.travel.distanceMetres / 100) / 10),
                margin: plan.marginMinutes,
              })}
              {plan.travel.estimate === 'straight_line'
                ? ` ${t('booking.cars.plan.estimate')}`
                : ''}
            </p>
            {!ride ? (
              <p className="font-body text-body-sm text-foreground">
                {t('booking.cars.plan.noRide')}
              </p>
            ) : phase.kind === 'ready' ? (
              <Button
                type="button"
                className="self-start"
                disabled={busy}
                data-testid="plan-book-ride"
                onClick={() => void bookRide(ride)}
              >
                {t('booking.cars.plan.book', { time: format.dateTime(ride.scheduledFor, zone) })}
              </Button>
            ) : phase.kind === 'loading' ? null : (
              <AppLink
                href={`/sign-in?next=${encodeURIComponent(`/bookings/${booking.id}`)}`}
                className={LINK}
              >
                {t('booking.cars.plan.signIn')}
              </AppLink>
            )}
          </div>
        ) : null}
      </section>
    </Card>
  );
}

function TripSuggestions({ booking }: { booking: Booking }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/bookings/{bookingId}/cars-suggestions', {
        params: { path: { bookingId: booking.id } },
        headers: bookingHeaders(booking.id),
      })
      .then(({ data }) => {
        if (!cancelled && data) setSuggestions(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [booking.id]);

  if (!suggestions) return null;
  const { ride, rental, bus } = suggestions;
  if (!ride && !rental && !bus) return null;
  const arrivalZone = booking.flight?.slices[0]?.destination.timeZone;
  const local = (value: string) =>
    `${format.date(value.slice(0, 10), 'medium')} ${wallTime(value)}`;

  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-suggestions" data-testid="cars-suggestions">
        <h2 id="booking-suggestions" className="font-heading text-h4 font-bold text-heading">
          {t('booking.cars.suggest.heading')}
        </h2>
        <ul className="flex flex-col gap-4">
          {ride ? (
            <li className="flex flex-col gap-1" data-testid="suggest-ride">
              <p className="font-body text-body font-bold text-foreground">
                {t('booking.cars.suggest.ride', { place: ride.pickupLabel })}
              </p>
              {ride.scheduledFor ? (
                <p className="font-body text-body-sm text-foreground">
                  {t('booking.cars.suggest.rideAt', {
                    time: format.dateTime(ride.scheduledFor, arrivalZone),
                  })}
                </p>
              ) : null}
              <AppLink
                href={`/rides?pickup=${ride.pickupPlaceId}${ride.scheduledFor ? `&at=${encodeURIComponent(ride.scheduledFor)}` : ''}`}
                className={LINK}
              >
                {t('booking.cars.suggest.rideAction')}
              </AppLink>
            </li>
          ) : null}
          {rental ? (
            <li className="flex flex-col gap-1" data-testid="suggest-rental">
              <p className="font-body text-body font-bold text-foreground">
                {t('booking.cars.suggest.rental', { city: rental.cityName })}
              </p>
              <p className="font-body text-body-sm text-foreground">
                {t('booking.cars.suggest.rentalPeriod', {
                  from: local(rental.pickupAtLocal),
                  until: local(rental.returnAtLocal),
                })}
              </p>
              <AppLink
                href={`/rentals?city=${encodeURIComponent(rental.cityName)}&pickupAt=${encodeURIComponent(rental.pickupAtLocal)}&returnAt=${encodeURIComponent(rental.returnAtLocal)}`}
                className={LINK}
              >
                {t('booking.cars.suggest.rentalAction')}
              </AppLink>
            </li>
          ) : null}
          {bus ? (
            <li className="flex flex-col gap-1" data-testid="suggest-bus">
              <p className="font-body text-body font-bold text-foreground">
                {t('booking.cars.suggest.bus', { city: bus.from })}
              </p>
              <AppLink
                href={`/buses?from=${encodeURIComponent(bus.from)}&date=${bus.date}`}
                className={LINK}
              >
                {t('booking.cars.suggest.busAction')}
              </AppLink>
            </li>
          ) : null}
        </ul>
      </section>
    </Card>
  );
}
