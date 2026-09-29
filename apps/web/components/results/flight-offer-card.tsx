'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, cn } from '@suskii/ui-web';
import { ChevronDown, Luggage } from 'lucide-react';
import { useId, useState } from 'react';

import type { Schemas } from '../../lib/browser-api';

import { useResultsT } from './results-messages';

type Offer = Schemas['FlightOffer'];
type Slice = Offer['slices'][number];

const time = (local: string): string => local.slice(11, 16);

function useDuration(): (minutes: number) => string {
  const { t } = useResultsT();
  return (minutes) =>
    t('results.flights.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function SliceRow({ slice, label }: { slice: Slice; label: string }) {
  const { t } = useResultsT();
  const format = useFormatters();
  const duration = useDuration();
  const via = slice.layovers.map((layover) => layover.airport.code);
  return (
    <div className="flex flex-col gap-1">
      <p className="font-body text-caption font-bold text-muted">
        {label} · {format.date(slice.departureLocal, 'weekday')}
      </p>
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <span className="font-heading text-h4 font-bold text-heading">
            {time(slice.departureLocal)}
          </span>
          <span className="font-body text-body-sm text-foreground">{slice.origin.code}</span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span className="font-body text-caption text-foreground">
            {duration(slice.durationMinutes)}
          </span>
          <span aria-hidden="true" className="h-0 w-full border-t border-border-strong" />
          <span className="font-body text-caption text-foreground">
            {slice.stops === 0
              ? t('results.flights.direct')
              : `${t('results.flights.stops', { count: slice.stops })} ${t('results.flights.via', {
                  airports: format.list(via),
                })}`}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-heading text-h4 font-bold text-heading">
            {time(slice.arrivalLocal)}
            {slice.arrivalDayOffset > 0 ? (
              <sup
                className="ml-1 font-body text-caption text-foreground"
                title={t('results.flights.arrivesLater', { count: slice.arrivalDayOffset })}
              >
                +{slice.arrivalDayOffset}
                <span className="sr-only">
                  {t('results.flights.arrivesLater', { count: slice.arrivalDayOffset })}
                </span>
              </sup>
            ) : null}
          </span>
          <span className="font-body text-body-sm text-foreground">{slice.destination.code}</span>
        </div>
      </div>
    </div>
  );
}

function sliceLabel(index: number, count: number, t: ReturnType<typeof useResultsT>['t']): string {
  if (count === 2 && index === 0) return t('results.flights.slice.outbound');
  if (count === 2 && index === 1) return t('results.flights.slice.return');
  if (count === 1) return t('results.flights.slice.outbound');
  return t('results.flights.slice.leg', { number: index + 1 });
}

function FareDetails({ offer }: { offer: Offer }) {
  const { t } = useResultsT();
  const format = useFormatters();
  const duration = useDuration();
  const { conditions } = offer;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      {offer.slices.map((slice, sliceIndex) => (
        <section key={sliceIndex} className="flex flex-col gap-2">
          <h4 className="font-heading text-body font-bold text-heading">
            {sliceLabel(sliceIndex, offer.slices.length, t)}:{' '}
            {slice.origin.cityName ?? slice.origin.code} →{' '}
            {slice.destination.cityName ?? slice.destination.code}
            {slice.fareBrand
              ? ` · ${t('results.flights.fareBrand', { brand: slice.fareBrand })}`
              : ''}
          </h4>
          <ol className="flex flex-col gap-2">
            {slice.segments.map((segment, segmentIndex) => {
              const layover = slice.layovers[segmentIndex];
              return (
                <li key={segmentIndex} className="flex flex-col gap-1">
                  <p className="font-body text-body-sm text-foreground">
                    <span className="font-bold">
                      {time(segment.departureLocal)} {segment.origin.code}
                    </span>{' '}
                    {segment.origin.name} →{' '}
                    <span className="font-bold">
                      {time(segment.arrivalLocal)} {segment.destination.code}
                    </span>{' '}
                    {segment.destination.name}
                  </p>
                  <p className="font-body text-caption text-foreground">
                    {t('results.flights.flight', {
                      carrier: segment.marketingCarrier.name,
                      number: segment.flightNumber,
                    })}{' '}
                    · {duration(segment.durationMinutes)}
                    {segment.aircraft ? ` · ${segment.aircraft}` : ''}
                    {segment.operatingCarrier.code !== segment.marketingCarrier.code
                      ? ` · ${t('results.flights.operatedBy', { carrier: segment.operatingCarrier.name })}`
                      : ''}
                  </p>
                  {layover ? (
                    <p className="flex flex-wrap items-center gap-2 font-body text-caption text-foreground">
                      {t('results.flights.layover', {
                        duration: duration(layover.durationMinutes),
                        airport: layover.airport.name ?? layover.airport.code,
                      })}
                      {layover.warnings.map((warning) => (
                        <Badge key={warning} variant="warning">
                          {t(`results.flights.layoverWarnings.${warning}`)}
                        </Badge>
                      ))}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <ul className="flex flex-col gap-1 font-body text-body-sm text-foreground">
        <li>{t('results.flights.carryOn')}</li>
        <li>{t('results.flights.checked', { count: offer.baggage.checked })}</li>
        <li>
          {conditions.refundable
            ? conditions.refundPenalty
              ? t('results.flights.refundFee', { amount: format.money(conditions.refundPenalty) })
              : t('results.flights.refundable')
            : t('results.flights.nonRefundable')}
        </li>
        <li>
          {conditions.changeable
            ? conditions.changePenalty
              ? t('results.flights.changeFee', { amount: format.money(conditions.changePenalty) })
              : t('results.flights.changeable')
            : t('results.flights.notChangeable')}
        </li>
      </ul>
    </div>
  );
}

export interface FlightOfferCardProps {
  offer: Offer;
  travellers: number;
  selecting: boolean;
  disabled: boolean;
  notice: { kind: 'priceChanged'; previous: string; current: string } | { kind: 'gone' } | null;
  onSelect: () => void;
  onContinue: () => void;
}

export function FlightOfferCard({
  offer,
  travellers,
  selecting,
  disabled,
  notice,
  onSelect,
  onContinue,
}: FlightOfferCardProps) {
  const { t } = useResultsT();
  const format = useFormatters();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const headingId = useId();
  const price = format.money(offer.price.total);
  return (
    <Card asChild interactive>
      <article
        aria-labelledby={headingId}
        className="flex flex-col gap-4 p-4"
        data-testid="flight-offer"
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={headingId} className="font-heading text-body font-bold text-heading">
            {offer.owner.name}
          </h3>
          <div className="flex flex-wrap gap-2">
            {offer.conditions.refundable ? (
              <Badge variant="success">{t('results.flights.refundable')}</Badge>
            ) : null}
            {offer.supplier === 'mock' ? (
              <Badge variant="neutral">{t('results.demoBadge')}</Badge>
            ) : null}
          </div>
        </header>
        <div className="flex flex-col gap-4">
          {offer.slices.map((slice, index) => (
            <SliceRow key={index} slice={slice} label={sliceLabel(index, offer.slices.length, t)} />
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-end md:justify-between">
          <p className="flex items-center gap-2 font-body text-body-sm text-foreground">
            <Luggage aria-hidden="true" className="size-4" />
            {t('results.flights.checked', { count: offer.baggage.checked })}
          </p>
          <div className="flex flex-col gap-2 md:items-end">
            <p className="flex flex-col md:items-end">
              <span className="font-heading text-h3 font-extrabold text-heading">{price}</span>
              <span className="font-body text-caption text-foreground">
                {t('results.flights.total', { count: travellers })}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((value) => !value)}
              >
                {open ? t('results.flights.hideDetails') : t('results.flights.details')}
                <ChevronDown aria-hidden="true" className={cn('size-4', open && 'rotate-180')} />
              </Button>
              <Button
                onClick={onSelect}
                loading={selecting}
                disabled={disabled}
                aria-label={t('results.flights.selectLabel', { carrier: offer.owner.name, price })}
              >
                {selecting ? t('results.flights.selecting') : t('results.flights.select')}
              </Button>
            </div>
          </div>
        </div>
        {notice ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-md bg-primary-subtle p-4 md:flex-row md:items-center md:justify-between"
          >
            <p className="font-body text-body-sm text-foreground">
              {notice.kind === 'gone'
                ? t('results.offerGone')
                : t('results.priceChanged', { previous: notice.previous, current: notice.current })}
            </p>
            {notice.kind === 'priceChanged' ? (
              <Button variant="secondary" onClick={onContinue}>
                {t('results.continueAtPrice', { price: notice.current })}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div id={detailsId} hidden={!open}>
          {open ? <FareDetails offer={offer} /> : null}
        </div>
      </article>
    </Card>
  );
}
