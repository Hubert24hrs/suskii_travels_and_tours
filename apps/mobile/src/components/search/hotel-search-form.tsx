import { useFormatters } from '@suskii/i18n/react';
import {
  createHotelSearchRequestSchema,
  emptyHotelDraft,
  hotelDraftToInput,
  hotelFormToParams,
  type HotelFormDraft,
} from '@suskii/shared';
import { Button, DateRangePicker } from '@suskii/ui-native';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { daysFromToday, fromIso, toIso } from '../../lib/dates';
import { toFieldErrors, type FieldErrors } from '../../lib/form-issues';
import { useT } from '../../providers/app-provider';

import { CityField, type CityOption } from './place-field';
import { RoomsPicker } from './rooms-picker';

export function HotelSearchForm() {
  const { t, locale } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [draft, setDraft] = useState<HotelFormDraft>(() => ({
    ...emptyHotelDraft(),
    checkIn: daysFromToday(14),
    checkOut: daysFromToday(16),
  }));
  const [city, setCity] = useState<CityOption | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = (patch: Partial<HotelFormDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const input = hotelDraftToInput(draft);
    const result = createHotelSearchRequestSchema().safeParse(input);
    if (!result.success) {
      setErrors(toFieldErrors(result.error.issues, input, t));
      return;
    }
    setErrors({});
    router.push(`/search/hotels?${hotelFormToParams(result.data).toString()}` as Href);
  };

  return (
    <View className="gap-4" testID="hotel-search-form">
      <CityField
        label={t('search.hotels.destination')}
        value={city}
        onChange={(value) => {
          setCity(value);
          update({ cityId: value?.id ?? '' });
        }}
        error={errors['destination.cityId']}
      />
      <DateRangePicker
        mode="range"
        label={t('search.hotels.dates')}
        value={{ from: fromIso(draft.checkIn), to: fromIso(draft.checkOut) }}
        onChange={(range) =>
          update({
            checkIn: range.from ? toIso(range.from) : '',
            checkOut: range.to ? toIso(range.to) : '',
          })
        }
        formatValue={(range) =>
          range.from && range.to
            ? format.dateRange(toIso(range.from), toIso(range.to), 'weekday')
            : range.from
              ? format.date(toIso(range.from), 'weekday')
              : undefined
        }
        placeholder={t('search.hotels.datesPlaceholder')}
        locale={locale}
        labels={{ done: t('search.datePicker.done'), close: t('search.datePicker.close') }}
      />
      {errors.checkIn || errors.checkOut ? (
        <Text className="font-body text-caption text-danger">
          {errors.checkIn ?? errors.checkOut}
        </Text>
      ) : null}
      <RoomsPicker rooms={draft.rooms} onChange={(rooms) => update({ rooms })} />
      <Button fullWidth onPress={submit}>
        {t('search.hotels.submit')}
      </Button>
    </View>
  );
}
