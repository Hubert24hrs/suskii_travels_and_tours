'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Card } from '@suskii/ui-web';

import type { Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

type Quote = Schemas['Quote'];
type Money = Schemas['Money'];

const time = (local: string): string => local.slice(11, 16);

export function TripSummary({ quote }: { quote: Quote }) {
  const { t } = useBookingT();
  const format = useFormatters();
  if (quote.flight) {
    const { offer } = quote.flight;
    return (
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-h4 font-bold text-heading">{t('checkout.trip')}</h2>
          {offer.supplier === 'mock' ? (
            <Badge variant="neutral">{t('results.demoBadge')}</Badge>
          ) : null}
        </div>
        <p className="font-body text-body-sm font-bold text-foreground">
          {offer.owner.name} · {t(`cabins.${offer.cabinClass}`)}
        </p>
        <ol className="flex flex-col gap-3">
          {offer.slices.map((slice, index) => (
            <li key={index} className="flex flex-col gap-1">
              <p className="font-body text-caption font-bold text-muted">
                {format.date(slice.departureLocal, 'weekday')}
              </p>
              <p className="font-body text-body text-foreground">
                <span className="font-bold">{time(slice.departureLocal)}</span>{' '}
                {slice.origin.cityName ?? slice.origin.code} ({slice.origin.code}) →{' '}
                <span className="font-bold">{time(slice.arrivalLocal)}</span>
                {slice.arrivalDayOffset > 0 ? ` +${slice.arrivalDayOffset}` : ''}{' '}
                {slice.destination.cityName ?? slice.destination.code} ({slice.destination.code})
              </p>
              <p className="font-body text-caption text-foreground">
                {slice.stops === 0
                  ? t('results.flights.direct')
                  : t('results.flights.stops', { count: slice.stops })}{' '}
                ·{' '}
                {t('results.flights.duration', {
                  hours: Math.floor(slice.durationMinutes / 60),
                  minutes: slice.durationMinutes % 60,
                })}
              </p>
            </li>
          ))}
        </ol>
        <ul className="flex flex-col gap-1 font-body text-body-sm text-foreground">
          <li>{t('results.flights.checked', { count: offer.baggage.checked })}</li>
          <li>
            {offer.conditions.refundable
              ? t('results.flights.refundable')
              : t('results.flights.nonRefundable')}
            {' · '}
            {offer.conditions.changeable
              ? t('results.flights.changeable')
              : t('results.flights.notChangeable')}
          </li>
        </ul>
      </Card>
    );
  }
  const hotel = quote.hotel;
  if (!hotel) return null;
  const { rate, request } = hotel;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-h4 font-bold text-heading">{t('checkout.stay')}</h2>
      </div>
      <p className="font-body text-body font-bold text-foreground">{hotel.name}</p>
      <p className="font-body text-body-sm text-foreground">
        {[hotel.area, hotel.cityName].filter(Boolean).join(', ')}
      </p>
      <p className="font-body text-body-sm text-foreground">
        {format.dateRange(request.checkIn, request.checkOut, 'medium')} ·{' '}
        {t('booking.nights', { count: hotel.nights })} ·{' '}
        {t('booking.rooms', { count: request.rooms.length })}
      </p>
      <p className="font-body text-body-sm text-foreground">
        {rate.roomName} · {t(`results.boards.${rate.board}`)}
      </p>
      <p className="font-body text-body-sm text-foreground">
        {rate.refundable
          ? rate.freeCancellationUntil
            ? t('results.hotels.freeCancellationUntil', {
                date: format.date(rate.freeCancellationUntil, 'medium'),
              })
            : t('results.hotels.freeCancellation')
          : t('results.hotels.nonRefundable')}
      </p>
    </Card>
  );
}

export interface PriceLines {
  price: Schemas['Price'];
  extras: Money | null;
  total: Money;
  payAtProperty: Money | null;
}

export function PriceSummary({ lines }: { lines: PriceLines }) {
  const { t } = useBookingT();
  const format = useFormatters();
  const { price } = lines;
  return (
    <Card className="flex flex-col gap-3 p-4" aria-labelledby="price-summary-title">
      <h2 id="price-summary-title" className="font-heading text-h4 font-bold text-heading">
        {t('checkout.summary')}
      </h2>
      <dl className="flex flex-col gap-2 font-body text-body-sm text-foreground">
        <div className="flex justify-between gap-4">
          <dt>{t('checkout.fare')}</dt>
          <dd>{format.money(price.fare)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{t('checkout.taxes')}</dt>
          <dd>{format.money(price.taxes)}</dd>
        </div>
        {price.fees.map((fee) => (
          <div key={fee.code} className="flex justify-between gap-4">
            <dt>{fee.label}</dt>
            <dd>{format.money(fee.amount)}</dd>
          </div>
        ))}
        {lines.extras ? (
          <div className="flex justify-between gap-4">
            <dt>{t('checkout.extrasLine')}</dt>
            <dd>{format.money(lines.extras)}</dd>
          </div>
        ) : null}
        {price.discount ? (
          <div className="flex justify-between gap-4">
            <dt>{t('checkout.discount', { code: price.discount.code })}</dt>
            <dd>-{format.money(price.discount.amount)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-border pt-2 font-heading text-h4 font-bold text-heading">
          <dt>{t('checkout.total')}</dt>
          <dd data-testid="checkout-total">{format.money(lines.total)}</dd>
        </div>
      </dl>
      <p className="font-body text-caption text-foreground">{t('checkout.totalNote')}</p>
      {lines.payAtProperty ? (
        <p className="font-body text-caption text-foreground">
          {t('checkout.payAtProperty', { amount: format.money(lines.payAtProperty) })}
        </p>
      ) : null}
    </Card>
  );
}
