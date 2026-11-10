'use client';

import { useFormatters } from '@suskii/i18n/react';
import { tripTitle, type TripComponent } from '@suskii/shared/lite';
import { Badge, Button, Card } from '@suskii/ui-web';
import { ArrowLeft, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { browserApi, idempotencyKey, problemSlug, type Schemas } from '../../lib/browser-api';
import { setActiveTrip, tripSearchHref } from '../../lib/trip-builder';
import { AppLink } from '../app-link';
import { chosenMethod, MethodChoice, type PaymentMethodName } from '../checkout/payment-choice';
import { ResultsLoading } from '../results/result-states';

import { useTripT } from './trip-messages';
import { TRIP_PART_VARIANT, TRIP_STATE_VARIANT } from './trip-states';

type Trip = Schemas['Trip'];
type Part = Trip['parts'][number];
type Phase =
  { kind: 'loading' } | { kind: 'ready'; trip: Trip } | { kind: 'missing' } | { kind: 'error' };

const POLL_MS = 2500;
const STOP_AFTER_MS = 5 * 60_000;

/** Payment or fulfilment in flight: the webhook decides, this page only watches. */
const shouldPoll = (trip: Trip): boolean =>
  trip.state === 'awaiting_payment' ||
  trip.parts.some((part) => part.state === 'paying' || part.state === 'paid');

/**
 * A combined trip (ADR-099): the parts the traveller asked for, each with its price, one total
 * and one payment. Every part is chosen on the ordinary search and checkout pages; this page
 * remembers which part is being chosen, so checkout adds the booking here instead of taking
 * payment. Money on screen comes from the API; nothing is added up in the browser.
 */
export function TripView({ tripId }: { tripId: string }) {
  const { t } = useTripT();
  const format = useFormatters();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethodName | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const started = useRef<number | null>(null);

  /** Loads again; the effect restarts the polling clock. */
  const reload = () => {
    started.current = null;
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    started.current ??= Date.now();
    const load = async () => {
      try {
        const { data, response } = await browserApi().GET('/v1/trips/{tripId}', {
          params: { path: { tripId } },
        });
        if (cancelled) return;
        if (response.status === 401) {
          router.replace(`/sign-in?next=${encodeURIComponent(`/trips/${tripId}`)}`);
          return;
        }
        if (!data) {
          setPhase({
            kind: response.status === 404 || response.status === 400 ? 'missing' : 'error',
          });
          return;
        }
        setPhase({ kind: 'ready', trip: data });
        const elapsed = Date.now() - (started.current ?? Date.now());
        if (shouldPoll(data) && elapsed < STOP_AFTER_MS)
          timer = setTimeout(() => void load(), POLL_MS);
      } catch {
        if (!cancelled) setPhase({ kind: 'error' });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tripId, attempt, router]);

  if (phase.kind === 'loading') return <ResultsLoading label={t('common.loading')} />;
  if (phase.kind === 'missing' || phase.kind === 'error')
    return (
      <Card role="alert" className="flex flex-col items-start gap-4 p-6">
        <p className="font-body text-body text-foreground">
          {t(phase.kind === 'missing' ? 'trips.page.missing' : 'trips.page.loadError')}
        </p>
        {phase.kind === 'error' ? (
          <Button onClick={reload}>{t('trips.page.retry')}</Button>
        ) : (
          <Button asChild variant="secondary">
            <AppLink href="/trips">{t('trips.page.back')}</AppLink>
          </Button>
        )}
      </Card>
    );

  const { trip } = phase;
  const { plan } = trip;
  const title = tripTitle(plan);
  const partOf = (component: TripComponent): Part | undefined =>
    trip.parts.find((part) => part.component === component && part.state !== 'closed') ??
    trip.parts.find((part) => part.component === component);
  const live = trip.parts.filter((part) => part.state !== 'closed');
  const settled = live.some((part) => part.state === 'paid' || part.state === 'confirmed');

  /** Remembers the part being chosen, then goes to its ordinary search. */
  const choose = (component: TripComponent) => {
    setActiveTrip({ id: trip.id, reference: trip.reference, component });
  };

  const remove = async (part: Part) => {
    setBusy(part.booking.id);
    setError(null);
    const { data, error: problem } = await browserApi().DELETE(
      '/v1/trips/{tripId}/parts/{bookingId}',
      { params: { path: { tripId: trip.id, bookingId: part.booking.id } } },
    );
    setBusy(null);
    if (data) setPhase({ kind: 'ready', trip: data });
    else
      setError(
        t(
          problemSlug(problem) === 'trip-part-paid'
            ? 'trips.page.errors.partPaid'
            : 'trips.page.errors.generic',
        ),
      );
  };

  const acceptPrice = async (part: Part) => {
    if (!part.priceChange) return;
    setBusy(part.booking.id);
    setError(null);
    const { data } = await browserApi().POST('/v1/bookings/{bookingId}/price-consent', {
      params: { path: { bookingId: part.booking.id } },
      body: { total: part.priceChange.current },
    });
    setBusy(null);
    if (!data) setError(t('trips.page.errors.generic'));
    reload();
  };

  const pay = async () => {
    setBusy('pay');
    setError(null);
    const {
      data,
      error: problem,
      response,
    } = await browserApi().POST('/v1/trips/{tripId}/payments', {
      params: { path: { tripId: trip.id }, header: { 'Idempotency-Key': idempotencyKey() } },
      body: { method: chosenMethod(trip.payment.methods, method) },
    });
    if (data) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    setBusy(null);
    const slug = problemSlug(problem);
    const key =
      slug === 'price-changed'
        ? 'priceChanged'
        : response.status === 410
          ? 'unavailable'
          : slug === 'trip-nothing-to-pay'
            ? 'nothingToPay'
            : response.status === 429
              ? 'tooMany'
              : slug === 'payment-provider-unavailable' ||
                  slug === 'payment-method-unavailable' ||
                  response.status === 503
                ? 'provider'
                : 'generic';
    setError(t(`trips.page.errors.${key}`));
    // A price or a part changed: show the trip as it stands now.
    if (key !== 'generic' && key !== 'tooMany' && key !== 'provider') reload();
  };

  const deleteTrip = async () => {
    setBusy('delete');
    setError(null);
    const { response } = await browserApi().DELETE('/v1/trips/{tripId}', {
      params: { path: { tripId: trip.id } },
    });
    if (response.ok) {
      router.push('/trips');
      return;
    }
    setBusy(null);
    setConfirmDelete(false);
    setError(
      t(response.status === 409 ? 'trips.page.errors.hasPayments' : 'trips.page.errors.generic'),
    );
  };

  const describe = (part: Part): string => {
    const { flight, hotel, product } = part.booking;
    if (flight)
      return t('trips.page.flightLine', {
        from: flight.origin.cityName ?? flight.origin.code,
        to: flight.destination.cityName ?? flight.destination.code,
        airline: flight.airline,
      });
    if (hotel) return `${hotel.name}, ${hotel.cityName}`;
    return product?.title ?? part.booking.reference;
  };

  const travellers = [
    t('trips.adults', { count: plan.adults }),
    ...(plan.children > 0 ? [t('trips.children', { count: plan.children })] : []),
  ].join(', ');

  return (
    <div className="flex flex-col gap-6">
      <AppLink
        href="/trips"
        className="inline-flex min-h-6 items-center gap-2 self-start font-body text-body-sm font-bold text-primary focus-visible:focus-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('trips.page.back')}
      </AppLink>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-h2 font-extrabold text-heading">
            {t('trips.route', title)}
          </h1>
          <Badge variant={TRIP_STATE_VARIANT[trip.state]} data-testid="trip-state">
            {t(`trips.states.${trip.state}`)}
          </Badge>
        </div>
        <p className="font-body text-body text-foreground" suppressHydrationWarning>
          {format.dateRange(plan.departDate, plan.returnDate, 'weekday')}
          {' · '}
          {travellers}
          {' · '}
          {t('trips.page.reference', { reference: trip.reference })}
        </p>
      </header>

      {trip.state === 'paid' ? (
        <p
          role="status"
          className="rounded-md bg-primary-subtle p-4 font-body text-body-sm text-foreground"
        >
          {t('trips.page.paid')}
        </p>
      ) : null}
      {trip.state === 'closed' ? (
        <p role="status" className="font-body text-body-sm text-foreground">
          {t('trips.page.closed')}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-surface p-4 font-body text-body-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-8">
        <section aria-labelledby="trip-parts" className="flex flex-col gap-4 lg:col-span-2">
          <h2 id="trip-parts" className="font-heading text-h3 font-bold text-heading">
            {t('trips.page.partsHeading')}
          </h2>
          <ol className="flex flex-col gap-3">
            {plan.components.map((component) => {
              const part = partOf(component);
              const label = t(`trips.components.${component}`);
              const open = !part || part.state === 'closed';
              return (
                <li key={component} data-testid={`trip-part-${component}`}>
                  <Card className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <h3 className="font-heading text-h4 font-bold text-heading">{label}</h3>
                        {part ? (
                          <>
                            <p className="font-body text-body text-foreground">{describe(part)}</p>
                            <p
                              className="font-body text-body-sm text-muted"
                              suppressHydrationWarning
                            >
                              {part.booking.endsOn
                                ? format.dateRange(part.booking.startsOn, part.booking.endsOn)
                                : format.date(part.booking.startsOn)}
                            </p>
                          </>
                        ) : (
                          <p className="font-body text-body-sm text-muted">
                            {t('trips.page.notAdded')}
                          </p>
                        )}
                      </div>
                      {part ? (
                        <div className="flex flex-col items-end gap-2">
                          <span
                            className="font-body text-body font-bold text-heading"
                            data-testid={`trip-price-${component}`}
                          >
                            {format.money(part.booking.total)}
                          </span>
                          <Badge variant={TRIP_PART_VARIANT[part.state]}>
                            {t(`trips.partStates.${part.state}`)}
                          </Badge>
                        </div>
                      ) : null}
                    </div>
                    {part?.priceChange && part.state !== 'closed' ? (
                      <div
                        role="alert"
                        className="flex flex-col items-start gap-2 rounded-md border border-border-strong p-3"
                      >
                        <p className="font-body text-body-sm text-foreground">
                          {t('trips.page.priceChanged', {
                            previous: format.money(part.priceChange.previous),
                            current: format.money(part.priceChange.current),
                          })}
                        </p>
                        <Button
                          loading={busy === part.booking.id}
                          onClick={() => void acceptPrice(part)}
                        >
                          {t('trips.page.acceptPrice')}
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      {open ? (
                        <Button asChild>
                          <AppLink
                            href={tripSearchHref(plan, component)}
                            onClick={() => choose(component)}
                          >
                            {t(`trips.page.choose.${component}`)}
                          </AppLink>
                        </Button>
                      ) : null}
                      {part ? (
                        <Button asChild variant="ghost">
                          <AppLink
                            href={`/bookings/${part.booking.id}`}
                            aria-label={t('trips.page.viewLabel', {
                              reference: part.booking.reference,
                            })}
                          >
                            {t('trips.page.viewBooking')}
                          </AppLink>
                        </Button>
                      ) : null}
                      {part?.state === 'to_pay' ? (
                        <>
                          <Button asChild variant="ghost">
                            <AppLink
                              href={tripSearchHref(plan, component)}
                              onClick={() => choose(component)}
                              aria-label={t('trips.page.changeLabel', { part: label })}
                            >
                              {t('trips.page.change')}
                            </AppLink>
                          </Button>
                          <Button
                            variant="ghost"
                            loading={busy === part.booking.id}
                            aria-label={t('trips.page.removeLabel', { part: label })}
                            onClick={() => void remove(part)}
                          >
                            {t('trips.page.remove')}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Card asChild className="flex flex-col gap-4 p-4">
            <section aria-labelledby="trip-review">
              <h2 id="trip-review" className="font-heading text-h3 font-bold text-heading">
                {t('trips.page.reviewHeading')}
              </h2>
              {live.length === 0 ? (
                <p className="font-body text-body-sm text-foreground">
                  {t('trips.page.nothingYet')}
                </p>
              ) : (
                <dl className="flex flex-col gap-2 font-body text-body-sm text-foreground">
                  {live.map((part) => (
                    <div key={part.booking.id} className="flex justify-between gap-4">
                      <dt>{t(`trips.components.${part.component}`)}</dt>
                      <dd>{format.money(part.booking.total)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 border-t border-border pt-2 text-body font-bold text-heading">
                    <dt>{t('trips.page.total')}</dt>
                    <dd data-testid="trip-total">{format.money(trip.total)}</dd>
                  </div>
                  {settled && trip.due.amountMinor > 0 ? (
                    <div className="flex justify-between gap-4 font-bold">
                      <dt>{t('trips.page.due')}</dt>
                      <dd data-testid="trip-due">{format.money(trip.due)}</dd>
                    </div>
                  ) : null}
                </dl>
              )}
              {trip.payment.open ? (
                <>
                  <p role="status" className="font-body text-body-sm text-foreground">
                    {t('trips.page.waiting')}
                  </p>
                  <Button asChild fullWidth>
                    <a href={trip.payment.open.checkoutUrl}>{t('trips.page.continuePayment')}</a>
                  </Button>
                </>
              ) : trip.due.amountMinor > 0 ? (
                <>
                  <MethodChoice
                    methods={trip.payment.methods}
                    value={method}
                    onChange={setMethod}
                  />
                  <Button
                    fullWidth
                    loading={busy === 'pay'}
                    onClick={() => void pay()}
                    data-testid="trip-pay"
                  >
                    {t('trips.page.pay', { amount: format.money(trip.due) })}
                  </Button>
                  <p className="flex items-start gap-2 font-body text-caption text-foreground">
                    <Lock aria-hidden="true" className="mt-1 size-4 shrink-0" />
                    {t('trips.page.payNote')}
                  </p>
                </>
              ) : trip.state === 'awaiting_payment' ? (
                <p role="status" className="font-body text-body-sm text-foreground">
                  {t('trips.page.waiting')}
                </p>
              ) : null}
            </section>
          </Card>
          {settled || trip.payment.open ? null : confirmDelete ? (
            <Card role="group" className="flex flex-col gap-3 p-4">
              <p className="font-body text-body-sm text-foreground">
                {t('trips.page.deleteConfirm')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button loading={busy === 'delete'} onClick={() => void deleteTrip()}>
                  {t('trips.page.deleteYes')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  {t('trips.page.deleteNo')}
                </Button>
              </div>
            </Card>
          ) : (
            <Button variant="ghost" className="self-start" onClick={() => setConfirmDelete(true)}>
              {t('trips.page.delete')}
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}
