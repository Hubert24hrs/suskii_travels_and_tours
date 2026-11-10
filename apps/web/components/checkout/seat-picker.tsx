'use client';

import { useFormatters } from '@suskii/i18n/react';
import { currencyExponent, type SeatChoice } from '@suskii/shared/lite';
import { Skeleton } from '@suskii/ui-web';
import { useEffect, useId, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

type SeatMaps = Schemas['FlightSeatMaps'];
type Flight = SeatMaps['flights'][number];
type Seat = NonNullable<Flight['rows'][number]['sections'][number][number]>;

/** A chosen seat with the airline's price for it, for the price summary. */
export type PricedSeat = SeatChoice & { price: Schemas['Money'] };

const SEAT =
  'flex size-12 flex-col items-center justify-center rounded-md border font-body text-body-sm font-bold focus-visible:focus-ring';

/**
 * Seat selection at checkout (ADR-094): the airline's seat map for each flight of the quote,
 * loaded when the traveller asks for it. One seat per traveller with a seat on each flight; a
 * press on a free seat gives it to the traveller being chosen for, a press on their own seat
 * hands it back. Prices are the airline's, shown on the seat and added to the total. Nothing
 * is held here: the API checks the map again when the booking is made and before payment.
 */
export default function SeatPicker({
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
  const { t } = useBookingT();
  const format = useFormatters();
  const groupId = useId();
  const [loaded, setLoaded] = useState<{ quoteId: string; maps: SeatMaps | null } | null>(null);
  const [flightIndex, setFlightIndex] = useState(0);
  const [active, setActive] = useState(travellers[0]?.index ?? 0);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/quotes/{quoteId}/seat-maps', { params: { path: { quoteId } } })
      .then(({ data }) => {
        if (!cancelled) setLoaded({ quoteId, maps: data ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ quoteId, maps: null });
      });
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  if (loaded?.quoteId !== quoteId)
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <p className="font-body text-body-sm text-foreground">{t('checkout.seats.loading')}</p>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  if (!loaded.maps)
    return (
      <p role="status" className="font-body text-body-sm text-foreground">
        {t('checkout.seats.failed')}
      </p>
    );
  const flights = loaded.maps.flights;
  const flight = flights[flightIndex] ?? flights[0];
  if (!flight)
    return (
      <p
        role="status"
        data-testid="seats-unavailable"
        className="font-body text-body-sm text-foreground"
      >
        {t('checkout.seats.unavailable')}
      </p>
    );

  const nameOf = (index: number): string =>
    travellers.find((traveller) => traveller.index === index)?.name ?? '';
  const holder = (designator: string): PricedSeat | undefined =>
    value.find((seat) => seat.flight === flight.flight && seat.designator === designator);
  const press = (seat: Seat): void => {
    const mine = holder(seat.designator);
    if (mine) {
      // Their own seat handed back; another traveller's seat is theirs to change.
      if (mine.passengerIndex === active) onChange(value.filter((entry) => entry !== mine));
      return;
    }
    const rest = value.filter(
      (entry) => !(entry.flight === flight.flight && entry.passengerIndex === active),
    );
    const next = [
      ...rest,
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
  const priceOf = (seat: Seat): string =>
    seat.price.amountMinor > 0 ? format.money(seat.price) : t('checkout.seats.noCharge');
  // On the seat itself only the amount fits; the currency is named once under the legend.
  const amountOf = (seat: Seat): string =>
    format.number(seat.price.amountMinor / 10 ** currencyExponent(seat.price.currency));
  const anyPriced = flight.rows.some((row) =>
    row.sections.some((section) => section.some((seat) => seat && seat.price.amountMinor > 0)),
  );

  return (
    <div className="flex flex-col gap-4" data-testid="seat-picker">
      {flights.length > 1 ? (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t('checkout.seats.heading')}</legend>
          {flights.map((entry, index) => (
            <label
              key={entry.flight}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 font-body text-body-sm text-foreground has-checked:border-primary has-checked:bg-primary-subtle"
            >
              <input
                type="radio"
                name={`${groupId}-flight`}
                checked={index === flightIndex}
                onChange={() => setFlightIndex(index)}
                data-testid={`seat-flight-${entry.flight}`}
              />
              {t('checkout.seats.flight', {
                origin: entry.origin.code,
                destination: entry.destination.code,
                flight: `${entry.carrier.code} ${entry.flightNumber}`,
              })}
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="font-body text-body-sm font-bold text-foreground">
          {t('checkout.seats.flight', {
            origin: flight.origin.code,
            destination: flight.destination.code,
            flight: `${flight.carrier.code} ${flight.flightNumber}`,
          })}
        </p>
      )}

      {travellers.length > 1 ? (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-1 font-body text-body-sm font-medium text-foreground">
            {t('checkout.seats.choosingFor')}
          </legend>
          {travellers.map((traveller) => (
            <label
              key={traveller.index}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 font-body text-body-sm text-foreground has-checked:border-primary has-checked:bg-primary-subtle"
            >
              <input
                type="radio"
                name={`${groupId}-traveller`}
                checked={traveller.index === active}
                onChange={() => setActive(traveller.index)}
                data-testid={`seat-traveller-${traveller.index}`}
              />
              {traveller.name}
            </label>
          ))}
        </fieldset>
      ) : null}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 font-body text-caption text-foreground">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-4 rounded-sm border border-border-strong" />
          {t('checkout.seats.legend.free')}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-4 rounded-sm bg-primary" />
          {t('checkout.seats.legend.yours')}
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 rounded-sm border border-border bg-background"
          />
          {t('checkout.seats.legend.taken')}
        </li>
      </ul>

      {anyPriced ? (
        <p className="font-body text-caption text-foreground">
          {t('checkout.seats.pricesIn', { currency: loaded.maps.currency })}
        </p>
      ) : null}

      {/* Seat letters name a side of the aircraft, so the map reads the same in every language. */}
      <div dir="ltr" className="max-h-menu overflow-auto rounded-md border border-border p-3">
        <div className="flex w-max flex-col gap-2">
          {flight.rows.map((row) => (
            <div
              key={row.number}
              role="group"
              aria-label={t('checkout.seats.row', { number: row.number })}
              className="flex items-center gap-2"
            >
              <span aria-hidden="true" className="w-8 font-body text-caption text-muted">
                {row.number}
              </span>
              {row.sections.map((section, sectionIndex) => (
                <span key={sectionIndex} className="flex gap-1 pe-4 last:pe-0">
                  {section.map((seat, position) => {
                    if (!seat) return <span key={position} className="size-12" />;
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
                            price: priceOf(seat),
                          })
                        : t('checkout.seats.seatTaken', { seat: seat.designator });
                    return (
                      <button
                        key={seat.designator}
                        type="button"
                        aria-label={label}
                        aria-pressed={held ? true : seat.available ? false : undefined}
                        disabled={!held && !seat.available}
                        onClick={() => press(seat)}
                        data-testid={`seat-${flight.flight}-${seat.designator}`}
                        className={
                          held
                            ? `${SEAT} border-primary bg-primary text-on-primary`
                            : seat.available
                              ? `${SEAT} border-border-strong bg-surface text-foreground`
                              : `${SEAT} cursor-not-allowed border-border bg-background text-muted`
                        }
                      >
                        <span aria-hidden="true">{seat.designator.replace(/^\d+/, '')}</span>
                        {seat.available && !held && seat.price.amountMinor > 0 ? (
                          <span aria-hidden="true" className="text-caption font-regular">
                            {amountOf(seat)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-1" aria-live="polite" data-testid="seat-summary">
        {travellers.map((traveller) => {
          const seat = value.find(
            (entry) => entry.flight === flight.flight && entry.passengerIndex === traveller.index,
          );
          return (
            <li key={traveller.index} className="font-body text-body-sm text-foreground">
              {seat
                ? t('checkout.seats.chosen', {
                    name: traveller.name,
                    seat: seat.designator,
                    price:
                      seat.price.amountMinor > 0
                        ? format.money(seat.price)
                        : t('checkout.seats.noCharge'),
                  })
                : t('checkout.seats.notChosen', { name: traveller.name })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
