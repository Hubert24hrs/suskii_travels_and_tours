import { color } from '@suskii/design-tokens';
import { useFormatters } from '@suskii/i18n/react';
import {
  CABIN_CLASSES,
  MAX_FLIGHT_SLICES,
  createFlightSearchFormSchema,
  emptyFlightDraft,
  flightDraftToInput,
  flightFormToParams,
  type CabinClass,
  type FlightFormDraft,
  type TripType,
} from '@suskii/shared';
import {
  Button,
  DateRangePicker,
  PassengerPicker,
  SegmentedControl,
  iconSize,
} from '@suskii/ui-native';
import { useRouter, type Href } from 'expo-router';
import { ArrowUpDown, Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { daysFromToday, fromIso, toIso } from '../../lib/dates';
import { toFieldErrors, type FieldErrors } from '../../lib/form-issues';
import { useT } from '../../providers/app-provider';

import { PlaceField, type PlaceOption } from './place-field';
import { passengerLabels, travellerSummary } from './traveller-labels';

type Leg = FlightFormDraft['legs'][number];

/** A return trip two weeks out, so the form is one tap from a search. */
export function defaultFlightDraft(): FlightFormDraft {
  return { ...emptyFlightDraft(), departureDate: daysFromToday(14), returnDate: daysFromToday(21) };
}

const emptyLeg = (departureDate = ''): Leg => ({ origin: '', destination: '', departureDate });

export function FlightSearchForm({ initial }: { initial?: FlightFormDraft }) {
  const { t, locale } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [draft, setDraft] = useState<FlightFormDraft>(() => initial ?? defaultFlightDraft());
  const [places, setPlaces] = useState<Record<string, PlaceOption | null>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const dateLabels = { done: t('search.datePicker.done'), close: t('search.datePicker.close') };

  const update = (patch: Partial<FlightFormDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const place = (key: string, code: string): PlaceOption | null =>
    places[key] ?? (code ? { code, name: code, city: code, countryCode: '' } : null);
  const choose = (key: string, value: PlaceOption | null, apply: (code: string) => void) => {
    setPlaces((current) => ({ ...current, [key]: value }));
    apply(value?.code ?? '');
  };
  const setLeg = (index: number, patch: Partial<Leg>) =>
    update({ legs: draft.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)) });

  const submit = () => {
    const input = flightDraftToInput(draft);
    const result = createFlightSearchFormSchema().safeParse(input);
    if (!result.success) {
      setErrors(toFieldErrors(result.error.issues, input, t));
      return;
    }
    setErrors({});
    router.push(`/search/flights?${flightFormToParams(result.data).toString()}` as Href);
  };

  const tripTypes: { value: TripType; label: string }[] = [
    { value: 'round_trip', label: t('search.flights.tripTypes.round_trip') },
    { value: 'one_way', label: t('search.flights.tripTypes.one_way') },
    { value: 'multi_city', label: t('search.flights.tripTypes.multi_city') },
  ];

  return (
    <View className="gap-4" testID="flight-search-form">
      <SegmentedControl
        label={t('search.flights.tripType')}
        options={tripTypes}
        value={draft.tripType}
        onValueChange={(tripType) => {
          setErrors({});
          update({
            tripType,
            ...(tripType === 'multi_city' && !draft.legs[0]?.departureDate
              ? { legs: [emptyLeg(draft.departureDate), emptyLeg()] }
              : {}),
          });
        }}
      />

      {draft.tripType === 'multi_city' ? (
        <View className="gap-4">
          {draft.legs.map((leg, index) => (
            <View key={index} className="gap-3 rounded-md border border-border p-3">
              <View className="flex-row items-center justify-between">
                <Text className="font-body-bold text-body text-heading">
                  {t('search.flights.leg', { number: index + 1 })}
                </Text>
                {draft.legs.length > 2 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('search.flights.removeLeg', { number: index + 1 })}
                    onPress={() => update({ legs: draft.legs.filter((_, i) => i !== index) })}
                    className="size-12 items-center justify-center"
                  >
                    <X color={color.muted} size={iconSize.md} />
                  </Pressable>
                ) : null}
              </View>
              <PlaceField
                label={t('search.flights.from')}
                value={place(`legs.${index}.origin`, leg.origin)}
                onChange={(value) =>
                  choose(`legs.${index}.origin`, value, (origin) => setLeg(index, { origin }))
                }
                error={errors[`legs.${index}.origin`]}
              />
              <PlaceField
                label={t('search.flights.to')}
                value={place(`legs.${index}.destination`, leg.destination)}
                onChange={(value) =>
                  choose(`legs.${index}.destination`, value, (destination) =>
                    setLeg(index, { destination }),
                  )
                }
                error={errors[`legs.${index}.destination`]}
              />
              <DateRangePicker
                mode="single"
                label={t('search.flights.depart')}
                value={{ from: fromIso(leg.departureDate) }}
                onChange={(range) =>
                  setLeg(index, { departureDate: range.from ? toIso(range.from) : '' })
                }
                formatValue={(range) =>
                  range.from ? format.date(toIso(range.from), 'weekday') : undefined
                }
                placeholder={t('search.flights.datePlaceholder')}
                locale={locale}
                labels={dateLabels}
              />
              {errors[`legs.${index}.departureDate`] ? (
                <Text className="font-body text-caption text-danger">
                  {errors[`legs.${index}.departureDate`]}
                </Text>
              ) : null}
            </View>
          ))}
          {draft.legs.length < MAX_FLIGHT_SLICES ? (
            <Button
              variant="ghost"
              icon={<Plus color={color.primary} size={iconSize.md} />}
              onPress={() => update({ legs: [...draft.legs, emptyLeg()] })}
            >
              {t('search.flights.addLeg')}
            </Button>
          ) : null}
        </View>
      ) : (
        <View className="gap-3">
          <PlaceField
            testID="search-from"
            label={t('search.flights.from')}
            value={place('origin', draft.origin)}
            onChange={(value) => choose('origin', value, (origin) => update({ origin }))}
            error={errors.origin}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.flights.swap')}
            onPress={() => {
              setPlaces((current) => ({
                ...current,
                origin: current.destination ?? null,
                destination: current.origin ?? null,
              }));
              update({ origin: draft.destination, destination: draft.origin });
            }}
            className="size-12 items-center justify-center self-end"
          >
            <ArrowUpDown color={color.primary} size={iconSize.md} />
          </Pressable>
          <PlaceField
            testID="search-to"
            label={t('search.flights.to')}
            value={place('destination', draft.destination)}
            onChange={(value) =>
              choose('destination', value, (destination) => update({ destination }))
            }
            error={errors.destination}
          />
          <DateRangePicker
            mode={draft.tripType === 'round_trip' ? 'range' : 'single'}
            label={
              draft.tripType === 'round_trip'
                ? t('search.flights.dates')
                : t('search.flights.depart')
            }
            value={{ from: fromIso(draft.departureDate), to: fromIso(draft.returnDate) }}
            onChange={(range) =>
              update({
                departureDate: range.from ? toIso(range.from) : '',
                returnDate: range.to ? toIso(range.to) : '',
              })
            }
            formatValue={(range) => {
              if (!range.from) return undefined;
              const from = toIso(range.from);
              return draft.tripType === 'round_trip' && range.to
                ? format.dateRange(from, toIso(range.to), 'weekday')
                : format.date(from, 'weekday');
            }}
            placeholder={
              draft.tripType === 'round_trip'
                ? t('search.flights.datesPlaceholder')
                : t('search.flights.datePlaceholder')
            }
            locale={locale}
            labels={dateLabels}
          />
          {errors.departureDate || errors.returnDate ? (
            <Text className="font-body text-caption text-danger">
              {errors.departureDate ?? errors.returnDate}
            </Text>
          ) : null}
        </View>
      )}

      <PassengerPicker
        label={t('search.travellers.label')}
        summary={travellerSummary(t, draft.travellers)}
        value={draft.travellers}
        onChange={(travellers) => update({ travellers })}
        labels={passengerLabels(t)}
      />
      {errors.travellers ? (
        <Text className="font-body text-caption text-danger">{errors.travellers}</Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <SegmentedControl
          label={t('search.flights.cabin')}
          options={CABIN_CLASSES.map((cabin: CabinClass) => ({
            value: cabin,
            label: t(`cabins.${cabin}`),
          }))}
          value={draft.cabinClass}
          onValueChange={(cabinClass) => update({ cabinClass })}
        />
      </ScrollView>
      <Button testID="search-submit" fullWidth onPress={submit}>
        {t('search.flights.submit')}
      </Button>
    </View>
  );
}
