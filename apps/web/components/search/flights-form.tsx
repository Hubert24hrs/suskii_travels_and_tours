'use client';

import { createFormatters } from '@suskii/i18n';
import {
  CABIN_CLASSES,
  MAX_FLIGHT_SLICES,
  MIN_MULTI_CITY_LEGS,
  createFlightSearchFormSchema,
  flightDraftToInput,
  flightFormToParams,
  type CabinClass,
  type FlightFormDraft,
  type TripType,
} from '@suskii/shared';
import { Button, DateRangePicker, PassengerPicker, SegmentedControl } from '@suskii/ui-web';
import { ArrowLeftRight, PlaneLanding, PlaneTakeoff, Plus, Search, X } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { dateToIso, isoToDate, localToday, weekStartsOn } from './dates';
import { focusFirstError, toFieldErrors, type FieldErrors } from './issues';
import { CheckboxField, NativeSelect } from './native-select';
import { PlaceField } from './place-field';
import { EMPTY_FLIGHT_STATE, emptyLeg, type FlightFormState, type Leg } from './form-state';
import type { PlaceOption } from './places';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { useTravellerLabels } from './traveller-labels';
import { useSearchT } from './use-search-t';

function toDraft(state: FlightFormState): FlightFormDraft {
  return {
    tripType: state.tripType,
    origin: state.origin?.code ?? '',
    destination: state.destination?.code ?? '',
    departureDate: state.departureDate,
    returnDate: state.tripType === 'round_trip' ? state.returnDate : '',
    legs: state.legs.map((leg) => ({
      origin: leg.origin?.code ?? '',
      destination: leg.destination?.code ?? '',
      departureDate: leg.date,
    })),
    travellers: state.travellers,
    cabinClass: state.cabinClass,
    directOnly: state.directOnly,
    flexibleDates: state.flexibleDates,
  };
}

const MAX_RECENT = 6;

export interface FlightsFormProps {
  apiBaseUrl: string;
  locale: string;
  /** Pre-filled state (from a search URL); otherwise the last search on this device is restored. */
  initial?: FlightFormState | undefined;
}

export function FlightsForm({ apiBaseUrl, locale, initial }: FlightsFormProps) {
  const { t } = useSearchT();
  const router = useRouter();
  const travellerLabels = useTravellerLabels();
  const format = useMemo(() => createFormatters(locale), [locale]);
  const [state, setState] = useState<FlightFormState>(initial ?? EMPTY_FLIGHT_STATE);
  const [recent, setRecent] = useState<PlaceOption[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const today = useMemo(() => localToday(), []);

  // Restore the last search and recent places after hydration: reading storage during render
  // would make the server and client HTML differ.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore from storage after mount.
    setRecent(readStored<PlaceOption[]>(STORAGE_KEYS.recentPlaces) ?? []);
    if (initial) return;
    const saved = readStored<FlightFormState>(STORAGE_KEYS.lastFlightSearch);
    if (saved?.tripType) setState({ ...EMPTY_FLIGHT_STATE, ...saved });
  }, [initial]);

  const update = (patch: Partial<FlightFormState>) =>
    setState((current) => ({ ...current, ...patch }));
  const updateLeg = (index: number, patch: Partial<Leg>) =>
    setState((current) => ({
      ...current,
      legs: current.legs.map((leg, position) => (position === index ? { ...leg, ...patch } : leg)),
    }));

  const formatRange = ({ from, to }: { from?: Date | undefined; to?: Date | undefined }) => {
    if (!from) return undefined;
    const start = format.date(dateToIso(from), 'weekday');
    return to ? `${start} - ${format.date(dateToIso(to), 'weekday')}` : start;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = flightDraftToInput(toDraft(state));
    const result = createFlightSearchFormSchema().safeParse(input);
    if (!result.success) {
      const found = toFieldErrors(result.error.issues, input, t);
      // Return-date problems are shown on the shared date-range field.
      if (found.returnDate && !found.departureDate) found.departureDate = found.returnDate;
      setErrors(found);
      focusFirstError(found, 'flight');
      return;
    }
    setErrors({});
    setSubmitting(true);
    writeStored(STORAGE_KEYS.lastFlightSearch, state);
    const chosen = [
      state.origin,
      state.destination,
      ...state.legs.flatMap((leg) => [leg.origin, leg.destination]),
    ];
    writeStored(
      STORAGE_KEYS.recentPlaces,
      [...chosen.filter((place): place is PlaceOption => place !== null), ...recent]
        .filter(
          (place, index, list) => list.findIndex((other) => other.code === place.code) === index,
        )
        .slice(0, MAX_RECENT),
    );
    router.push(`/flights/search?${flightFormToParams(result.data).toString()}` as Route);
  };

  const place = (props: {
    id: string;
    label: string;
    value: PlaceOption | null;
    onChange: (value: PlaceOption | null) => void;
    icon: React.ReactNode;
  }) => (
    <PlaceField
      {...props}
      recent={recent}
      apiBaseUrl={apiBaseUrl}
      locale={locale}
      error={errors[props.id.replace(/^flight-/, '').replaceAll('-', '.')]}
    />
  );

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('search.tabs.flights')}
    >
      <SegmentedControl<TripType>
        label={t('search.flights.tripType')}
        value={state.tripType}
        onValueChange={(tripType) => update({ tripType })}
        options={[
          { value: 'round_trip', label: t('search.flights.tripTypes.round_trip') },
          { value: 'one_way', label: t('search.flights.tripTypes.one_way') },
          { value: 'multi_city', label: t('search.flights.tripTypes.multi_city') },
        ]}
        className="self-start"
      />

      {state.tripType === 'multi_city' ? (
        <ol className="flex flex-col gap-4">
          {state.legs.map((leg, index) => (
            <li
              key={index}
              className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-start"
            >
              <p className="font-body text-body-sm font-bold text-heading lg:hidden">
                {t('search.flights.leg', { number: index + 1 })}
              </p>
              <div className="grid flex-1 gap-3 md:grid-cols-3">
                {place({
                  id: `flight-legs-${index}-origin`,
                  label: t('search.flights.from'),
                  value: leg.origin,
                  onChange: (origin) => updateLeg(index, { origin }),
                  icon: <PlaneTakeoff className="size-5" />,
                })}
                {place({
                  id: `flight-legs-${index}-destination`,
                  label: t('search.flights.to'),
                  value: leg.destination,
                  onChange: (destination) => updateLeg(index, { destination }),
                  icon: <PlaneLanding className="size-5" />,
                })}
                <DateRangePicker
                  id={`flight-legs-${index}-departureDate`}
                  mode="single"
                  label={t('search.flights.depart')}
                  placeholder={t('search.flights.datePlaceholder')}
                  value={{ from: isoToDate(leg.date) }}
                  onChange={({ from }) => updateLeg(index, { date: dateToIso(from) })}
                  formatValue={formatRange}
                  minDate={today}
                  weekStartsOn={weekStartsOn(locale)}
                  labels={{
                    done: t('search.datePicker.done'),
                    close: t('search.datePicker.close'),
                    previousMonth: t('search.datePicker.previousMonth'),
                    nextMonth: t('search.datePicker.nextMonth'),
                  }}
                  error={errors[`legs.${index}.departureDate`]}
                />
              </div>
              {state.legs.length > MIN_MULTI_CITY_LEGS ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('search.flights.removeLeg', { number: index + 1 })}
                  className="self-end px-3 lg:mt-6"
                  onClick={() =>
                    update({ legs: state.legs.filter((_, position) => position !== index) })
                  }
                >
                  <X aria-hidden="true" className="size-5" />
                </Button>
              ) : null}
            </li>
          ))}
          {state.legs.length < MAX_FLIGHT_SLICES ? (
            <li>
              <Button
                type="button"
                variant="ghost"
                className="px-3"
                onClick={() => update({ legs: [...state.legs, emptyLeg()] })}
              >
                <Plus aria-hidden="true" className="size-5" />
                {t('search.flights.addLeg')}
              </Button>
            </li>
          ) : null}
        </ol>
      ) : (
        <div className="grid gap-3 lg:grid-cols-12 lg:items-start">
          <div className="flex flex-col gap-2 md:flex-row md:items-start lg:col-span-6">
            <div className="flex-1">
              {place({
                id: 'flight-origin',
                label: t('search.flights.from'),
                value: state.origin,
                onChange: (origin) => update({ origin }),
                icon: <PlaneTakeoff className="size-5" />,
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('search.flights.swap')}
              className="relative z-10 -my-4 self-end px-3 md:my-0 md:mt-6 md:self-start"
              onClick={() => update({ origin: state.destination, destination: state.origin })}
            >
              <ArrowLeftRight aria-hidden="true" className="size-5 rotate-90 md:rotate-0" />
            </Button>
            <div className="flex-1">
              {place({
                id: 'flight-destination',
                label: t('search.flights.to'),
                value: state.destination,
                onChange: (destination) => update({ destination }),
                icon: <PlaneLanding className="size-5" />,
              })}
            </div>
          </div>
          <DateRangePicker
            id="flight-departureDate"
            className="lg:col-span-3"
            mode={state.tripType === 'round_trip' ? 'range' : 'single'}
            label={
              state.tripType === 'round_trip'
                ? t('search.flights.dates')
                : t('search.flights.depart')
            }
            placeholder={
              state.tripType === 'round_trip'
                ? t('search.flights.datesPlaceholder')
                : t('search.flights.datePlaceholder')
            }
            value={{ from: isoToDate(state.departureDate), to: isoToDate(state.returnDate) }}
            onChange={({ from, to }) =>
              update({ departureDate: dateToIso(from), returnDate: dateToIso(to) })
            }
            formatValue={formatRange}
            minDate={today}
            weekStartsOn={weekStartsOn(locale)}
            labels={{
              done: t('search.datePicker.done'),
              close: t('search.datePicker.close'),
              previousMonth: t('search.datePicker.previousMonth'),
              nextMonth: t('search.datePicker.nextMonth'),
            }}
            error={errors.departureDate}
          />
          <PassengerPicker
            id="flight-travellers"
            className="lg:col-span-3"
            label={t('search.travellers.label')}
            summary={travellerLabels.summary(state.travellers)}
            value={state.travellers}
            onChange={(travellers) => update({ travellers })}
            labels={travellerLabels.labels}
            error={errors['travellers.infants'] ?? errors.travellers}
          />
        </div>
      )}

      {state.tripType === 'multi_city' ? (
        <PassengerPicker
          id="flight-travellers"
          className="md:max-w-popover"
          label={t('search.travellers.label')}
          summary={travellerLabels.summary(state.travellers)}
          value={state.travellers}
          onChange={(travellers) => update({ travellers })}
          labels={travellerLabels.labels}
          error={errors['travellers.infants'] ?? errors.travellers}
        />
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-6">
          <NativeSelect
            id="flight-cabinClass"
            label={t('search.flights.cabin')}
            value={state.cabinClass}
            onChange={(event) => update({ cabinClass: event.target.value as CabinClass })}
            options={CABIN_CLASSES.map((cabin) => ({ value: cabin, label: t(`cabins.${cabin}`) }))}
            className="sm:w-auto"
          />
          <CheckboxField
            label={t('search.flights.directOnly')}
            checked={state.directOnly}
            onChange={(event) => update({ directOnly: event.target.checked })}
          />
          <CheckboxField
            label={t('search.flights.flexibleDates')}
            checked={state.flexibleDates}
            onChange={(event) => update({ flexibleDates: event.target.checked })}
          />
        </div>
        <Button type="submit" fullWidth="mobile" loading={submitting}>
          <Search aria-hidden="true" className="size-5" />
          {t('search.flights.submit')}
        </Button>
      </div>
      <p role="alert" className="font-body text-body-sm text-danger empty:hidden">
        {Object.keys(errors).length > 0 ? t('search.issues.summary') : ''}
      </p>
    </form>
  );
}
