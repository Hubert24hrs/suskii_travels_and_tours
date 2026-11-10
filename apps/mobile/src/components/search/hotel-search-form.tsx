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
import { Pressable, Text, View } from 'react-native';

import { daysFromToday, fromIso, toIso } from '../../lib/dates';
import { toFieldErrors, type FieldErrors } from '../../lib/form-issues';
import { recentHotelSearches, type RecentHotelSearch } from '../../lib/recent-hotel-searches';
import { useT } from '../../providers/app-provider';

import { CityField, type CityOption } from './place-field';
import { RoomsPicker } from './rooms-picker';

/**
 * "Continue your search" (ADR-097): the last hotel searches made on this device, as shortcuts
 * to their results. Nothing renders when there are none.
 */
function RecentSearches() {
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [searches, setSearches] = useState<RecentHotelSearch[]>(() => recentHotelSearches.list());
  if (searches.length === 0) return null;
  const open = (search: RecentHotelSearch): void => {
    const params = new URLSearchParams({
      dest: search.cityId,
      checkin: search.checkIn,
      checkout: search.checkOut,
    });
    for (const room of search.rooms) {
      params.append('room', [room.adults, ...room.childAges].join('-'));
    }
    router.push(`/search/hotels?${params.toString()}` as Href);
  };
  return (
    <View testID="recent-hotel-searches" className="gap-2">
      <Text accessibilityRole="header" className="font-body-bold text-body text-heading">
        {t('results.discover.recentHeading')}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {searches.map((search) => (
          <Pressable
            key={`${search.cityId}-${search.checkIn}-${search.checkOut}`}
            testID="recent-hotel-search"
            accessibilityRole="button"
            onPress={() => open(search)}
            className="min-h-12 justify-center rounded-pill border border-border-strong bg-surface px-4"
          >
            <Text className="font-body-bold text-body-sm text-foreground">
              {t('results.discover.recentItem', {
                city: search.cityName,
                dates: format.dateRange(search.checkIn, search.checkOut),
                guests: t('results.discover.recentGuests', {
                  count: search.rooms.reduce(
                    (sum, room) => sum + room.adults + room.childAges.length,
                    0,
                  ),
                }),
              })}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="font-body text-caption text-muted">
          {t('results.discover.recentNote')}
        </Text>
        <Pressable
          testID="recent-hotel-clear"
          accessibilityRole="button"
          onPress={() => {
            recentHotelSearches.clear();
            setSearches([]);
          }}
          className="min-h-12 justify-center"
        >
          <Text className="font-body-bold text-caption text-primary">
            {t('results.discover.recentClear')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

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
      <RecentSearches />
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
        testID="hotel-dates"
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
      <Button testID="hotel-submit" fullWidth onPress={submit}>
        {t('search.hotels.submit')}
      </Button>
    </View>
  );
}
