'use client';

import { useFormatters } from '@suskii/i18n/react';
import {
  arrivingFlight,
  normalisePassport,
  normalisePhone,
  passengerDrafts,
  tripFacts,
  tripPartFacts,
  validateCheckout,
  type FieldIssues,
  type ItineraryFacts,
  type LocaleCode,
  type PassengerDraft,
  type TripComponent,
} from '@suskii/shared/lite';
import { Button, Card, Input } from '@suskii/ui-web';
import { ArrowLeft, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { browserApi, idempotencyKey, problemSlug, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';
import {
  asIssue,
  checkAddonDetails,
  DETAIL_FIELDS,
  formPath,
  NO_DETAILS,
  normaliseFlightNumber,
  withMarketing,
  type AddonDetailsDraft,
  type DetailField,
} from '../checkout/booking-form';
import { PassengerFields, type CountryOption } from '../checkout/passenger-fields';
import { ResultsLoading } from '../results/result-states';

import { useTripT } from './trip-messages';

type Trip = Schemas['Trip'];
type Quote = Schemas['Quote'];
type Prepared = NonNullable<Trip['prepared']>[number];

interface Ready {
  kind: 'ready';
  trip: Trip;
  prepared: Prepared[];
  quotes: Quote[];
  facts: ItineraryFacts;
}
type Phase =
  | { kind: 'loading' }
  | Ready
  | { kind: 'nothing'; tripId: string }
  | { kind: 'expired'; part: TripComponent }
  | { kind: 'missing' }
  | { kind: 'error' };

interface Draft {
  passengers: PassengerDraft[];
  email: string;
  phone: string;
  terms: boolean;
}

/** The transfer details the trip's add-ons ask for, once (ADR-118). */
const detailFieldsOf = (quotes: readonly Quote[]): DetailField[] => [
  ...new Set(
    quotes.flatMap((quote) =>
      (quote.addon?.requiredDetails ?? []).flatMap((field) =>
        DETAIL_FIELDS[field] ? [DETAIL_FIELDS[field]] : [],
      ),
    ),
  ),
];

/**
 * One details form for a whole trip (ADR-118): the contact and every traveller once, for each
 * part Ask Suskii prepared. The API books each part as an ordinary booking with the travellers
 * its quote was priced for, all or nothing, and the trip page then takes one payment. The
 * checks here mirror the API's (`validateCheckout` over the trip's facts); the API checks again.
 */
export function TripDetails({
  tripId,
  countries,
  locale,
}: {
  tripId: string;
  countries: readonly CountryOption[];
  locale: LocaleCode;
}) {
  const { t } = useTripT();
  const format = useFormatters();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [details, setDetails] = useState<AddonDetailsDraft>(NO_DETAILS);
  const [errors, setErrors] = useState<FieldIssues>({});
  const [warnings, setWarnings] = useState<FieldIssues>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const bookKey = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const { data: trip, response } = await browserApi().GET('/v1/trips/{tripId}', {
        params: { path: { tripId } },
      });
      if (cancelled) return;
      if (response.status === 401) {
        router.replace(`/sign-in?next=${encodeURIComponent(`/trips/${tripId}/details`)}`);
        return;
      }
      if (!trip) {
        setPhase({ kind: response.status === 404 ? 'missing' : 'error' });
        return;
      }
      const prepared = trip.prepared ?? [];
      if (prepared.length === 0) {
        setPhase({ kind: 'nothing', tripId: trip.id });
        return;
      }
      const answers = await Promise.all(
        prepared.map((part) =>
          browserApi().GET('/v1/quotes/{quoteId}', {
            params: { path: { quoteId: part.quoteId } },
          }),
        ),
      );
      if (cancelled) return;
      const quotes: Quote[] = [];
      for (const [index, answer] of answers.entries()) {
        const part = prepared[index];
        if (!answer.data || !part) {
          setPhase({ kind: 'expired', part: part?.component ?? 'flight' });
          return;
        }
        quotes.push(answer.data);
      }
      const facts = tripFacts(quotes.map((quote) => tripPartFacts(quote)));
      if (!facts) {
        setPhase({ kind: 'error' });
        return;
      }
      setPhase({ kind: 'ready', trip, prepared, quotes, facts });
      setDraft({ passengers: passengerDrafts(facts.counts), email: '', phone: '', terms: false });
      // A transfer meets the flight the trip arrives on: start from it, the traveller can change it.
      const flight = quotes.find((quote) => quote.flight)?.flight;
      const arriving = flight ? arrivingFlight(flight.offer) : null;
      if (arriving) setDetails({ ...NO_DETAILS, ...arriving });
    };
    load().catch(() => {
      if (!cancelled) setPhase({ kind: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, router]);

  const ready = phase.kind === 'ready' ? phase : null;
  const detailFields = useMemo(() => (ready ? detailFieldsOf(ready.quotes) : []), [ready]);

  if (phase.kind === 'loading') return <ResultsLoading label={t('common.loading')} />;
  if (phase.kind !== 'ready' || !draft) {
    const message =
      phase.kind === 'nothing'
        ? t('trips.details.nothing')
        : phase.kind === 'expired'
          ? t('trips.details.errors.expired', { part: t(`trips.components.${phase.part}`) })
          : phase.kind === 'missing'
            ? t('trips.page.missing')
            : t('trips.page.loadError');
    return (
      <Card role="alert" className="flex flex-col items-start gap-4 p-6">
        <p className="font-body text-body text-foreground">{message}</p>
        <Button asChild variant="secondary">
          <AppLink href={phase.kind === 'missing' ? '/trips' : `/trips/${tripId}`}>
            {t('trips.details.back')}
          </AppLink>
        </Button>
      </Card>
    );
  }

  const { trip, prepared, quotes, facts } = phase;
  const flightPrepared = quotes.some((quote) => quote.flight);
  const passport: 'required' | 'optional' | 'none' = facts.international
    ? 'required'
    : flightPrepared
      ? 'optional'
      : 'none';

  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const updatePassenger = (index: number, patch: Partial<PassengerDraft>) =>
    update({
      passengers: draft.passengers.map((passenger, i) =>
        i === index ? { ...passenger, ...patch } : passenger,
      ),
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const checked = validateCheckout({ ...draft, guests: [] }, facts);
    const found = { ...checked.errors, ...checkAddonDetails(detailFields, details) };
    setErrors(found);
    setWarnings(checked.warnings);
    if (Object.keys(found).length > 0) {
      summaryRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        contact: { email: draft.email.trim(), phone: normalisePhone(draft.phone) },
        travellers: draft.passengers.map((passenger) => ({
          type: passenger.type,
          title: passenger.title as 'mr',
          gender: passenger.gender as 'm',
          givenNames: passenger.givenNames,
          surname: passenger.surname,
          dateOfBirth: passenger.dateOfBirth,
          nationality: passenger.nationality,
          document: passenger.passportNumber
            ? {
                number: normalisePassport(passenger.passportNumber),
                issuingCountry: passenger.issuingCountry,
                expiryDate: passenger.passportExpiry,
              }
            : null,
        })),
        addonDetails:
          detailFields.length > 0
            ? {
                flightNumber: detailFields.includes('flightNumber')
                  ? normaliseFlightNumber(details.flightNumber)
                  : null,
                arrivalTime: detailFields.includes('arrivalTime') ? details.arrivalTime : null,
                pickupAddress: detailFields.includes('pickupAddress')
                  ? details.pickupAddress.trim()
                  : null,
              }
            : null,
        termsVersion: quotes[0]?.termsVersion ?? '',
        acceptTerms: true as const,
        locale,
        // Only with marketing consent; the API re-checks the recorded choice (ADR-079).
        ...withMarketing(),
      };
      const serialised = JSON.stringify(body);
      if (bookKey.current?.body !== serialised)
        bookKey.current = { body: serialised, key: idempotencyKey() };
      const { data, error, response } = await browserApi().POST('/v1/trips/{tripId}/book', {
        params: {
          path: { tripId: trip.id },
          header: { 'Idempotency-Key': bookKey.current.key },
        },
        body,
      });
      if (data) {
        // Every part is booked: the trip page takes the one payment.
        router.push(`/trips/${trip.id}`);
        return;
      }
      const slug = problemSlug(error);
      const problem = error as {
        part?: TripComponent;
        issues?: { index: number | null; path: string[]; code: string }[];
        missing?: string[];
      };
      const part = problem.part ? t(`trips.components.${problem.part}`) : '';
      if (slug === 'passengers-invalid' && problem.issues) {
        const mapped: FieldIssues = {};
        for (const issue of problem.issues) {
          const key =
            issue.index === null
              ? 'passengers'
              : formPath(`passengers.${issue.index}.${issue.path.join('.')}`);
          mapped[key] = asIssue(issue.code);
        }
        setErrors(mapped);
        setFormError(t('trips.details.errors.part', { part }));
      } else if (slug === 'addon-details-invalid') {
        const mapped: FieldIssues = {};
        for (const field of problem.missing ?? []) {
          const key = DETAIL_FIELDS[field];
          if (key) mapped[`addonDetails.${key}`] = 'required';
        }
        setErrors(mapped);
        setFormError(t('trips.details.errors.part', { part }));
      } else if (slug === 'trip-travellers-short') {
        setFormError(t('trips.details.errors.short', { part }));
      } else if (slug === 'trip-nothing-prepared') {
        setFormError(t('trips.details.errors.nothing'));
      } else if (response.status === 410) {
        setFormError(t('trips.details.errors.expired', { part }));
      } else if (problem.part) {
        setFormError(t('trips.details.errors.part', { part }));
      } else setFormError(t('trips.details.errors.generic'));
      summaryRef.current?.focus();
    } catch {
      setFormError(t('trips.details.errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const errorCount = Object.keys(errors).length;
  const numbers = { adult: 0, child: 0, infant: 0 };

  return (
    <div className="flex flex-col gap-6">
      <AppLink
        href={`/trips/${trip.id}`}
        className="inline-flex min-h-6 items-center gap-2 self-start font-body text-body-sm font-bold text-primary focus-visible:focus-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('trips.details.back')}
      </AppLink>
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('trips.details.heading')}
        </h1>
        <p className="font-body text-body text-foreground">{t('trips.details.intro')}</p>
      </header>

      <form
        method="post"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-8"
      >
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div ref={summaryRef} tabIndex={-1} className="focus-visible:focus-ring">
            {errorCount > 0 || formError ? (
              <p
                role="alert"
                data-testid="trip-details-error"
                className="rounded-md border border-danger bg-surface p-4 font-body text-body-sm text-danger"
              >
                {formError ?? t('checkout.issues.summary')}
                {errors.passengers ? ` ${t(`checkout.issues.${errors.passengers}`)}` : ''}
              </p>
            ) : null}
          </div>

          <section aria-labelledby="trip-details-travellers" className="flex flex-col gap-4">
            <h2
              id="trip-details-travellers"
              className="font-heading text-h3 font-bold text-heading"
            >
              {t('trips.details.travellersHeading')}
            </h2>
            {draft.passengers.map((passenger, index) => {
              numbers[passenger.type] += 1;
              return (
                <PassengerFields
                  key={index}
                  index={index}
                  label={t(`checkout.traveller.${passenger.type}`, {
                    number: numbers[passenger.type],
                  })}
                  value={passenger}
                  onChange={(patch) => updatePassenger(index, patch)}
                  countries={countries}
                  passport={passport}
                  services={[]}
                  errors={errors}
                  warnings={warnings}
                />
              );
            })}
          </section>

          {detailFields.length > 0 ? (
            <Card asChild className="flex flex-col gap-4 p-4">
              <section aria-labelledby="trip-details-transfer">
                <h2
                  id="trip-details-transfer"
                  className="font-heading text-h3 font-bold text-heading"
                >
                  {t('checkout.addonDetails.heading')}
                </h2>
                <p className="font-body text-body-sm text-foreground">
                  {t('checkout.addonDetails.hint')}
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {detailFields.includes('flightNumber') ? (
                    <Input
                      id="addonDetails-flightNumber"
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={8}
                      label={t('checkout.addonDetails.flightNumber')}
                      hint={t('checkout.addonDetails.flightNumberHint')}
                      value={details.flightNumber}
                      onChange={(event) =>
                        setDetails({ ...details, flightNumber: event.target.value })
                      }
                      error={
                        errors['addonDetails.flightNumber'] === 'invalid'
                          ? t('checkout.addonDetails.invalidFlightNumber')
                          : errors['addonDetails.flightNumber']
                            ? t(`checkout.issues.${errors['addonDetails.flightNumber']}`)
                            : undefined
                      }
                    />
                  ) : null}
                  {detailFields.includes('arrivalTime') ? (
                    <Input
                      id="addonDetails-arrivalTime"
                      type="datetime-local"
                      label={t('checkout.addonDetails.arrivalTime')}
                      value={details.arrivalTime}
                      onChange={(event) =>
                        setDetails({ ...details, arrivalTime: event.target.value })
                      }
                      error={
                        errors['addonDetails.arrivalTime']
                          ? t(`checkout.issues.${errors['addonDetails.arrivalTime']}`)
                          : undefined
                      }
                    />
                  ) : null}
                  {detailFields.includes('pickupAddress') ? (
                    <Input
                      id="addonDetails-pickupAddress"
                      autoComplete="street-address"
                      maxLength={300}
                      label={t('checkout.addonDetails.pickupAddress')}
                      value={details.pickupAddress}
                      onChange={(event) =>
                        setDetails({ ...details, pickupAddress: event.target.value })
                      }
                      error={
                        errors['addonDetails.pickupAddress']
                          ? t(`checkout.issues.${errors['addonDetails.pickupAddress']}`)
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              </section>
            </Card>
          ) : null}

          <Card asChild className="flex flex-col gap-4 p-4">
            <section aria-labelledby="trip-details-contact">
              <h2 id="trip-details-contact" className="font-heading text-h3 font-bold text-heading">
                {t('checkout.contact')}
              </h2>
              <p className="font-body text-body-sm text-foreground">{t('checkout.contactHint')}</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  id="contact-email"
                  type="email"
                  autoComplete="email"
                  label={t('checkout.fields.email')}
                  value={draft.email}
                  onChange={(event) => update({ email: event.target.value })}
                  error={errors.email ? t(`checkout.issues.${errors.email}`) : undefined}
                />
                <Input
                  id="contact-phone"
                  type="tel"
                  autoComplete="tel"
                  label={t('checkout.fields.phone')}
                  hint={t('checkout.fields.phoneHint')}
                  value={draft.phone}
                  onChange={(event) => update({ phone: event.target.value })}
                  error={errors.phone ? t(`checkout.issues.${errors.phone}`) : undefined}
                />
              </div>
            </section>
          </Card>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Card asChild className="flex flex-col gap-4 p-4">
            <section aria-labelledby="trip-details-parts">
              <h2 id="trip-details-parts" className="font-heading text-h3 font-bold text-heading">
                {t('trips.details.partsHeading')}
              </h2>
              <dl className="flex flex-col gap-2 font-body text-body-sm text-foreground">
                {prepared.map((part) => (
                  <div
                    key={part.quoteId}
                    className="flex justify-between gap-4"
                    data-testid={`trip-details-part-${part.component}`}
                  >
                    <dt>
                      {t(`trips.components.${part.component}`)}
                      <span className="block text-caption text-muted">{part.title}</span>
                    </dt>
                    <dd>{format.money(part.price)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 border-t border-border pt-2 text-body font-bold text-heading">
                  <dt>{t('trips.page.totalWithPrepared')}</dt>
                  <dd data-testid="trip-details-total">
                    {format.money(trip.totalWithPrepared ?? trip.total)}
                  </dd>
                </div>
              </dl>
              {flightPrepared ? (
                <p className="font-body text-caption text-foreground">
                  {t('trips.details.bagsNote')}
                </p>
              ) : null}
            </section>
          </Card>
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3 font-body text-body-sm text-foreground">
              <input
                type="checkbox"
                name="terms"
                className="mt-1 size-5 shrink-0 accent-primary"
                checked={draft.terms}
                aria-invalid={errors.terms ? true : undefined}
                aria-describedby={errors.terms ? 'terms-error' : undefined}
                onChange={(event) => update({ terms: event.target.checked })}
              />
              {t('checkout.terms')}
            </label>
            {errors.terms ? (
              <p id="terms-error" className="font-body text-caption text-danger">
                {t('checkout.issues.terms')}
              </p>
            ) : null}
            <Button type="submit" fullWidth loading={submitting} data-testid="trip-details-submit">
              {submitting ? t('trips.details.booking') : t('trips.details.submit')}
            </Button>
            <p className="flex items-center gap-2 font-body text-caption text-foreground">
              <Lock aria-hidden="true" className="size-4" />
              {t('checkout.secure')}
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}
