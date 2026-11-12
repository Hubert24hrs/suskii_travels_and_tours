import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { currencyExponent, type SeatChoice } from '@suskii/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useApp, useT } from '../../providers/app-provider';

type Flight = Schemas['FlightSeatMaps']['flights'][number];
type Seat = NonNullable<Flight['rows'][number]['sections'][number][number]>;

/** A chosen seat with the airline's price for it, for the total. */
export type PricedSeat = SeatChoice & { price: Schemas['Money'] };

const CHIP = 'min-h-12 justify-center rounded-pill border border-border-strong px-4';
const CHIP_ON = 'min-h-12 justify-center rounded-pill bg-primary px-4';
const SEAT = 'size-12 items-center justify-center rounded-md border';

/**
 * Seat selection at checkout (ADR-094): the airline's seat map for each flight of the quote
 * (`seat-{flight}-{designator}`). One seat per traveller with a seat on each flight; a press on
 * a free seat gives it to the traveller being chosen for (`seat-traveller-{index}`), a press on
 * their own seat hands it back. Prices are the airline's. Nothing is held here: the API checks
 * the map again when the booking is made and before payment.
 */
export function SeatPicker({
  quoteId,
  travellers,
  value,
  onChange,
}: {
  quoteId: string;
  /** Travellers with a seat of their own, by their index in the passenger list. */
  travellers: readonly { index: number; name: string }[];
  value: readonly PricedSeat[];
  onChange: (seats: PricedSeat[]) => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [flightIndex, setFlightIndex] = useState(0);
  const [active, setActive] = useState(travellers[0]?.index ?? 0);
  const maps = useQuery({
    queryKey: ['seat-maps', quoteId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.GET('/v1/quotes/{quoteId}/seat-maps', {
        params: { path: { quoteId } },
      });
      if (!data) throw new Error('seat-maps');
      return data;
    },
  });

  if (maps.isPending) {
    return (
      <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-foreground">
        {t('checkout.seats.loading')}
      </Text>
    );
  }
  if (!maps.data) {
    return (
      <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-foreground">
        {t('checkout.seats.failed')}
      </Text>
    );
  }
  const flights = maps.data.flights;
  const flight = flights[flightIndex] ?? flights[0];
  if (!flight) {
    return (
      <Text testID="seats-unavailable" className="font-body text-body-sm text-foreground">
        {t('checkout.seats.unavailable')}
      </Text>
    );
  }

  const nameOf = (index: number): string =>
    travellers.find((traveller) => traveller.index === index)?.name ?? '';
  const holder = (designator: string): PricedSeat | undefined =>
    value.find((seat) => seat.flight === flight.flight && seat.designator === designator);
  const press = (seat: Seat): void => {
    const mine = holder(seat.designator);
    if (mine) {
      if (mine.passengerIndex === active) onChange(value.filter((entry) => entry !== mine));
      return;
    }
    const next = [
      ...value.filter(
        (entry) => !(entry.flight === flight.flight && entry.passengerIndex === active),
      ),
      {
        flight: flight.flight,
        passengerIndex: active,
        designator: seat.designator,
        price: seat.price,
      },
    ];
    onChange(next);
    // On to the next traveller who has no seat on this flight yet.
    const waiting = travellers.find(
      (traveller) =>
        !next.some(
          (entry) => entry.flight === flight.flight && entry.passengerIndex === traveller.index,
        ),
    );
    if (waiting) setActive(waiting.index);
  };
  const details = (seat: Seat): string =>
    seat.features.length > 0
      ? seat.features.map((feature) => t(`checkout.seats.features.${feature}`)).join(', ')
      : t('checkout.seats.standard');
  const priceOf = (money: Schemas['Money']): string =>
    money.amountMinor > 0 ? format.money(money) : t('checkout.seats.noCharge');
  // On the seat itself only the amount fits; the currency is named once above the map.
  const amountOf = (seat: Seat): string =>
    format.number(seat.price.amountMinor / 10 ** currencyExponent(seat.price.currency));
  const anyPriced = flight.rows.some((row) =>
    row.sections.some((section) => section.some((seat) => seat && seat.price.amountMinor > 0)),
  );
  const flightName = (entry: Flight): string =>
    t('checkout.seats.flight', {
      origin: entry.origin.code,
      destination: entry.destination.code,
      flight: `${entry.carrier.code} ${entry.flightNumber}`,
    });

  return (
    <View testID="seat-picker" className="gap-3">
      {flights.length > 1 ? (
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          {flights.map((entry, index) => (
            <Pressable
              key={entry.flight}
              testID={`seat-flight-${entry.flight}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: index === flightIndex }}
              onPress={() => setFlightIndex(index)}
              className={index === flightIndex ? CHIP_ON : CHIP}
            >
              <Text
                className={
                  index === flightIndex
                    ? 'font-body-bold text-body-sm text-on-primary'
                    : 'font-body text-body-sm text-foreground'
                }
              >
                {flightName(entry)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text className="font-body-bold text-body-sm text-foreground">{flightName(flight)}</Text>
      )}

      {travellers.length > 1 ? (
        <View className="gap-1">
          <Text className="font-body-medium text-body-sm text-foreground">
            {t('checkout.seats.choosingFor')}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('checkout.seats.choosingFor')}
            className="flex-row flex-wrap gap-2"
          >
            {travellers.map((traveller) => (
              <Pressable
                key={traveller.index}
                testID={`seat-traveller-${traveller.index}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: traveller.index === active }}
                onPress={() => setActive(traveller.index)}
                className={traveller.index === active ? CHIP_ON : CHIP}
              >
                <Text
                  className={
                    traveller.index === active
                      ? 'font-body-bold text-body-sm text-on-primary'
                      : 'font-body text-body-sm text-foreground'
                  }
                >
                  {traveller.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {anyPriced ? (
        <Text className="font-body text-caption text-foreground">
          {t('checkout.seats.pricesIn', { currency: maps.data.currency })}
        </Text>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="gap-2">
          {flight.rows.map((row) => (
            <View key={row.number} className="flex-row items-center gap-2">
              <Text className="w-8 font-body text-caption text-muted">{row.number}</Text>
              {row.sections.map((section, sectionIndex) => (
                <View key={sectionIndex} className="flex-row gap-1 pr-4">
                  {section.map((seat, position) => {
                    if (!seat) return <View key={position} className="size-12" />;
                    const held = holder(seat.designator);
                    const label = held
                      ? t('checkout.seats.seatYours', {
                          seat: seat.designator,
                          name: nameOf(held.passengerIndex),
                        })
                      : seat.available
                        ? t('checkout.seats.seatFree', {
                            seat: seat.designator,
                            details: details(seat),
                            price: priceOf(seat.price),
                          })
                        : t('checkout.seats.seatTaken', { seat: seat.designator });
                    const disabled = !held && !seat.available;
                    return (
                      <Pressable
                        key={seat.designator}
                        testID={`seat-${flight.flight}-${seat.designator}`}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: Boolean(held), disabled }}
                        disabled={disabled}
                        onPress={() => press(seat)}
                        className={
                          held
                            ? `${SEAT} border-primary bg-primary`
                            : seat.available
                              ? `${SEAT} border-border-strong bg-surface`
                              : `${SEAT} border-border bg-background`
                        }
                      >
                        <Text
                          className={
                            held
                              ? 'font-body-bold text-body-sm text-on-primary'
                              : seat.available
                                ? 'font-body-bold text-body-sm text-foreground'
                                : 'font-body text-body-sm text-muted'
                          }
                        >
                          {seat.designator.replace(/^\d+/, '')}
                        </Text>
                        {seat.available && !held && seat.price.amountMinor > 0 ? (
                          <Text className="font-body text-caption text-foreground">
                            {amountOf(seat)}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      <View testID="seat-summary" accessibilityLiveRegion="polite" className="gap-1">
        {travellers.map((traveller) => {
          const seat = value.find(
            (entry) => entry.flight === flight.flight && entry.passengerIndex === traveller.index,
          );
          return (
            <Text key={traveller.index} className="font-body text-body-sm text-foreground">
              {seat
                ? t('checkout.seats.chosen', {
                    name: traveller.name,
                    seat: seat.designator,
                    price: priceOf(seat.price),
                  })
                : t('checkout.seats.notChosen', { name: traveller.name })}
            </Text>
          );
        })}
      </View>
    </View>
  );
}
