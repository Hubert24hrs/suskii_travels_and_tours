'use client';

import { createFormatters } from '@suskii/i18n';
import {
  createHotelSearchRequestSchema,
  hotelDraftToInput,
  hotelFormToParams,
} from '@suskii/shared';
import { Button, DateRangePicker } from '@suskii/ui-web';
import { Search } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

import { CityField, type CityOption } from './city-field';
import { EMPTY_HOTEL_STATE, type HotelFormState } from './form-state';
import { dateToIso, isoToDate, localToday, weekStartsOn } from './dates';
import { focusFirstError, toFieldErrors, type FieldErrors } from './issues';
import { CheckboxField } from './native-select';
import { RoomsPicker } from './rooms-picker';
import { useSearchT } from './use-search-t';

export interface HotelsFormProps {
  apiBaseUrl: string;
  locale: string;
  suggestions: readonly CityOption[];
  initial?: HotelFormState | undefined;
}

export default function HotelsForm({ apiBaseUrl, locale, suggestions, initial }: HotelsFormProps) {
  const { t } = useSearchT();
  const router = useRouter();
  const format = useMemo(() => createFormatters(locale), [locale]);
  const today = useMemo(() => localToday(), []);
  const [state, setState] = useState<HotelFormState>(initial ?? EMPTY_HOTEL_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const update = (patch: Partial<HotelFormState>) =>
    setState((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = hotelDraftToInput({
      cityId: state.city?.id ?? '',
      checkIn: state.checkIn,
      checkOut: state.checkOut,
      rooms: state.rooms,
      freeCancellationOnly: state.freeCancellationOnly,
    });
    const result = createHotelSearchRequestSchema().safeParse(input);
    if (!result.success) {
      const found = toFieldErrors(result.error.issues, input, t);
      if (found.checkOut && !found.checkIn) found.checkIn = found.checkOut;
      setErrors(found);
      focusFirstError(found, 'hotel');
      return;
    }
    setErrors({});
    setSubmitting(true);
    router.push(`/hotels/search?${hotelFormToParams(result.data).toString()}` as Route);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('search.tabs.hotels')}
    >
      <div className="grid gap-3 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-5">
          <CityField
            id="hotel-destination-cityId"
            label={t('search.hotels.destination')}
            placeholder={t('search.hotels.destinationPlaceholder')}
            value={state.city}
            onChange={(city) => update({ city })}
            suggestions={suggestions}
            apiBaseUrl={apiBaseUrl}
            error={errors['destination.cityId']}
          />
        </div>
        <DateRangePicker
          id="hotel-checkIn"
          className="lg:col-span-4"
          mode="range"
          label={t('search.hotels.dates')}
          placeholder={t('search.hotels.datesPlaceholder')}
          value={{ from: isoToDate(state.checkIn), to: isoToDate(state.checkOut) }}
          onChange={({ from, to }) => update({ checkIn: dateToIso(from), checkOut: dateToIso(to) })}
          formatValue={({ from, to }) =>
            from
              ? to
                ? format.dateRange(dateToIso(from), dateToIso(to), 'weekday')
                : format.date(dateToIso(from), 'weekday')
              : undefined
          }
          minDate={today}
          weekStartsOn={weekStartsOn(locale)}
          labels={{
            done: t('search.datePicker.done'),
            close: t('search.datePicker.close'),
            previousMonth: t('search.datePicker.previousMonth'),
            nextMonth: t('search.datePicker.nextMonth'),
          }}
          error={errors.checkIn}
        />
        <div className="lg:col-span-3">
          <RoomsPicker
            id="hotel-rooms"
            value={state.rooms}
            onChange={(rooms) => update({ rooms })}
            error={errors.rooms}
          />
        </div>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CheckboxField
          name="freeCancellationOnly"
          label={t('search.hotels.freeCancellation')}
          checked={state.freeCancellationOnly}
          onChange={(event) => update({ freeCancellationOnly: event.target.checked })}
        />
        <Button type="submit" fullWidth="mobile" loading={submitting}>
          <Search aria-hidden="true" className="size-5" />
          {t('search.hotels.submit')}
        </Button>
      </div>
      <p role="alert" className="font-body text-body-sm text-danger empty:hidden">
        {Object.keys(errors).length > 0 ? t('search.issues.summary') : ''}
      </p>
    </form>
  );
}
