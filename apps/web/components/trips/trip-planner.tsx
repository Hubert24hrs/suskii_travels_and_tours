'use client';

import { useFormatters } from '@suskii/i18n/react';
import {
  TRIP_COMPONENTS,
  TRIP_MAX_ADULTS,
  TRIP_MAX_CHILDREN,
  TRIP_MAX_NIGHTS,
  tripTitle,
  type CurrencyCode,
  type TripComponent,
} from '@suskii/shared/lite';
import { Badge, Button, Card, DateRangePicker } from '@suskii/ui-web';
import { PlaneLanding, PlaneTakeoff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { clearPlanDraft, readPlanDraft, savePlanDraft } from '../../lib/trip-builder';
import { useSignedIn } from '../account/use-signed-in';
import { AppLink } from '../app-link';
import { dateToIso, isoToDate, localToday, weekStartsOn } from '../search/dates';
import { CheckboxField } from '../search/native-select';
import { PlaceField } from '../search/place-field';
import type { PlaceOption } from '../search/places';
import { Stepper } from '../search/stepper';
import { readStored, STORAGE_KEYS } from '../search/storage';

import { usePlannerT } from './trip-messages';
import { TRIP_STATE_VARIANT } from './trip-states';

type Trip = Schemas['Trip'];

interface PlanState {
  origin: PlaceOption | null;
  destination: PlaceOption | null;
  departDate: string;
  returnDate: string;
  adults: number;
  children: number;
  components: TripComponent[];
}

type Field = 'origin' | 'destination' | 'dates' | 'components';
type Errors = Partial<Record<Field | 'form', string>>;

const DAY_MS = 86_400_000;
const nightsBetween = (start: string, end: string): number =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);

const SIGN_IN = `/sign-in?next=${encodeURIComponent('/trips')}`;

/**
 * Where a combined trip starts (ADR-099): where from and to, the dates, the travellers and the
 * parts wanted. Nothing is searched or priced here; the trip's page sends the traveller to the
 * ordinary search for each part. A trip belongs to an account, so a visitor signs in first and
 * finds the plan they typed waiting.
 */
export function TripPlanner({
  apiBaseUrl,
  locale,
  currency,
  components,
}: {
  apiBaseUrl: string;
  locale: string;
  /** The visitor's display currency: every part of the trip is booked and paid in it. */
  currency: CurrencyCode;
  /** The parts on sale (car rental can be switched off, ADR-049). */
  components: readonly TripComponent[];
}) {
  const { t } = usePlannerT();
  const format = useFormatters();
  const router = useRouter();
  const signedIn = useSignedIn();
  const today = useMemo(() => localToday(), []);
  const [state, setState] = useState<PlanState>({
    origin: null,
    destination: null,
    departDate: '',
    returnDate: '',
    adults: 1,
    children: 0,
    components: [...components],
  });
  const [recent, setRecent] = useState<PlaceOption[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const summary = useRef<HTMLDivElement>(null);

  // After hydration: recent airports, and a plan typed before signing in.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore from storage after mount.
    setRecent(readStored<PlaceOption[]>(STORAGE_KEYS.recentPlaces) ?? []);
    const draft = readPlanDraft<PlanState>();
    if (draft && Array.isArray(draft.components)) {
      setState((current) => ({
        ...current,
        ...draft,
        components: draft.components.filter((part) => components.includes(part)),
      }));
    }
  }, [components]);

  useEffect(() => {
    if (!signedIn) return;
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
  }, [signedIn]);

  const update = (patch: Partial<PlanState>) => setState((current) => ({ ...current, ...patch }));
  const toggle = (part: TripComponent, on: boolean) =>
    update({
      // Kept in the order parts are added to a trip.
      components: TRIP_COMPONENTS.filter((item) =>
        item === part ? on : state.components.includes(item),
      ),
    });

  const check = (): Errors => {
    const found: Errors = {};
    if (!state.origin) found.origin = t('trips.plan.errors.origin');
    if (!state.destination) found.destination = t('trips.plan.errors.destination');
    else if (state.origin?.code === state.destination.code)
      found.destination = t('trips.plan.errors.same');
    if (!state.departDate || !state.returnDate || state.returnDate <= state.departDate)
      found.dates = t('trips.plan.errors.dates');
    else if (nightsBetween(state.departDate, state.returnDate) > TRIP_MAX_NIGHTS)
      found.dates = t('trips.plan.errors.tooLong', { nights: TRIP_MAX_NIGHTS });
    if (state.components.length === 0) found.components = t('trips.plan.errors.parts');
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0 || !state.origin || !state.destination) {
      summary.current?.focus();
      return;
    }
    if (!signedIn) {
      savePlanDraft(state);
      router.push(SIGN_IN);
      return;
    }
    setSubmitting(true);
    try {
      // The destination's catalog city, for the hotel and add-on searches.
      const airport = await browserApi().GET('/v1/catalog/airports/{iataCode}', {
        params: { path: { iataCode: state.destination.code } },
      });
      const { data, error, response } = await browserApi().POST('/v1/trips', {
        body: {
          plan: {
            origin: {
              code: state.origin.code,
              name: state.origin.name,
              cityName: state.origin.city || null,
              countryCode: state.origin.countryCode,
            },
            destination: {
              code: state.destination.code,
              name: state.destination.name,
              cityName: state.destination.city || null,
              countryCode: state.destination.countryCode,
              cityId: airport.data?.cityId ?? null,
            },
            departDate: state.departDate,
            returnDate: state.returnDate,
            adults: state.adults,
            children: state.children,
            components: state.components,
          },
          currency,
        },
      });
      if (data) {
        clearPlanDraft();
        router.push(`/trips/${data.id}`);
        return;
      }
      if (response.status === 401) {
        savePlanDraft(state);
        router.push(SIGN_IN);
        return;
      }
      setErrors({
        form:
          problemSlug(error) === 'too-many-trips'
            ? t('trips.plan.errors.tooMany')
            : t('trips.plan.errors.generic'),
      });
    } catch {
      setErrors({ form: t('trips.plan.errors.generic') });
    }
    setSubmitting(false);
    summary.current?.focus();
  };

  const formatRange = ({ from, to }: { from?: Date | undefined; to?: Date | undefined }) => {
    if (!from) return undefined;
    const start = format.date(dateToIso(from), 'weekday');
    return to ? `${start} - ${format.date(dateToIso(to), 'weekday')}` : start;
  };
  const firstError = errors.form ?? Object.values(errors)[0];

  return (
    <div className="flex flex-col gap-8">
      <Card asChild className="p-4 md:p-6">
        <form
          method="post"
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-6"
          aria-labelledby="trip-plan-heading"
        >
          <h2 id="trip-plan-heading" className="font-heading text-h3 font-bold text-heading">
            {t('trips.plan.heading')}
          </h2>
          {signedIn ? null : (
            <p className="font-body text-body-sm text-foreground">
              {t('trips.plan.signIn')}{' '}
              <AppLink
                href={SIGN_IN}
                className="inline-flex min-h-6 items-center font-bold text-primary underline focus-visible:focus-ring"
              >
                {t('trips.plan.signInAction')}
              </AppLink>
            </p>
          )}
          <div ref={summary} tabIndex={-1} className="focus-visible:focus-ring">
            {firstError ? (
              <p
                role="alert"
                className="rounded-md border border-danger bg-surface p-4 font-body text-body-sm text-danger"
              >
                {firstError}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <PlaceField
              id="trip-origin"
              label={t('trips.plan.from')}
              value={state.origin}
              onChange={(origin) => update({ origin })}
              recent={recent}
              apiBaseUrl={apiBaseUrl}
              locale={locale}
              error={errors.origin}
              icon={<PlaneTakeoff className="size-5" />}
            />
            <PlaceField
              id="trip-destination"
              label={t('trips.plan.to')}
              value={state.destination}
              onChange={(destination) => update({ destination })}
              recent={recent}
              apiBaseUrl={apiBaseUrl}
              locale={locale}
              error={errors.destination}
              icon={<PlaneLanding className="size-5" />}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2 md:items-start">
            <DateRangePicker
              id="trip-dates"
              mode="range"
              label={t('trips.plan.dates')}
              placeholder={t('trips.plan.datesPlaceholder')}
              value={{ from: isoToDate(state.departDate), to: isoToDate(state.returnDate) }}
              onChange={({ from, to }) =>
                update({ departDate: dateToIso(from), returnDate: dateToIso(to) })
              }
              formatValue={formatRange}
              minDate={today}
              weekStartsOn={weekStartsOn(locale)}
              labels={{
                done: t('search.datePicker.done'),
                close: t('search.datePicker.close'),
                previousMonth: t('search.datePicker.previousMonth'),
                nextMonth: t('search.datePicker.nextMonth'),
                today: t('search.datePicker.today'),
                selected: t('search.datePicker.selected'),
              }}
              error={errors.dates}
            />
            <div className="flex flex-col gap-3">
              <Stepper
                label={t('trips.plan.adults')}
                value={state.adults}
                min={1}
                max={TRIP_MAX_ADULTS}
                onChange={(adults) => update({ adults })}
                incrementLabel={t('trips.plan.addAdult')}
                decrementLabel={t('trips.plan.removeAdult')}
              />
              <Stepper
                label={t('trips.plan.children')}
                hint={t('trips.plan.childrenHint')}
                value={state.children}
                min={0}
                max={TRIP_MAX_CHILDREN}
                onChange={(children) => update({ children })}
                incrementLabel={t('trips.plan.addChild')}
                decrementLabel={t('trips.plan.removeChild')}
              />
            </div>
          </div>
          <fieldset
            className="flex flex-col gap-1"
            aria-describedby={errors.components ? 'trip-parts-error' : 'trip-parts-hint'}
          >
            <legend className="font-body text-body font-bold text-foreground">
              {t('trips.plan.parts')}
            </legend>
            <p id="trip-parts-hint" className="font-body text-body-sm text-muted">
              {t('trips.plan.partsHint')}
            </p>
            <div className="grid gap-x-6 md:grid-cols-2 lg:grid-cols-3">
              {components.map((part) => (
                <CheckboxField
                  key={part}
                  name="components"
                  value={part}
                  label={t(`trips.components.${part}`)}
                  checked={state.components.includes(part)}
                  onChange={(event) => toggle(part, event.target.checked)}
                />
              ))}
            </div>
            {errors.components ? (
              <p id="trip-parts-error" className="font-body text-caption text-danger">
                {errors.components}
              </p>
            ) : null}
          </fieldset>
          <Button type="submit" fullWidth="mobile" loading={submitting} className="self-start">
            {t('trips.plan.submit')}
          </Button>
        </form>
      </Card>

      {trips.length > 0 ? (
        <section aria-labelledby="trip-list-heading" className="flex flex-col gap-4">
          <h2 id="trip-list-heading" className="font-heading text-h3 font-bold text-heading">
            {t('trips.list.heading')}
          </h2>
          <ul className="flex flex-col gap-3">
            {trips.map((trip) => {
              const title = tripTitle(trip.plan);
              const live = trip.parts.filter((part) => part.state !== 'closed').length;
              return (
                <li key={trip.id}>
                  <Card
                    interactive
                    className="relative flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div className="flex flex-col gap-1">
                      <h3 className="font-heading text-h4 font-bold text-heading">
                        <AppLink
                          href={`/trips/${trip.id}`}
                          className="after:absolute after:inset-0 focus-visible:focus-ring"
                        >
                          {t('trips.route', title)}
                        </AppLink>
                      </h3>
                      <p
                        className="font-body text-body-sm text-foreground"
                        suppressHydrationWarning
                      >
                        {format.dateRange(trip.plan.departDate, trip.plan.returnDate)}
                        {' · '}
                        {live > 0 ? t('trips.list.parts', { count: live }) : t('trips.list.none')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {trip.total.amountMinor > 0 ? (
                        <span className="font-body text-body font-bold text-heading">
                          {format.money(trip.total)}
                        </span>
                      ) : null}
                      <Badge variant={TRIP_STATE_VARIANT[trip.state]}>
                        {t(`trips.states.${trip.state}`)}
                      </Badge>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
