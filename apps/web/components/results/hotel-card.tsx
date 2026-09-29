'use client';

import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-web';
import { MapPin, Star } from 'lucide-react';
import { useId } from 'react';

import type { Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useResultsT } from './results-messages';

type Hotel = Schemas['HotelSummary'];

export function Stars({ count }: { count: number }) {
  const { t } = useResultsT();
  return (
    <span
      className="inline-flex items-center gap-1"
      role="img"
      aria-label={t('results.hotels.stars', { count })}
    >
      {Array.from({ length: count }, (_, index) => (
        <Star key={index} aria-hidden="true" className="size-4 fill-accent text-accent" />
      ))}
    </span>
  );
}

export function ReviewScore({ score, count }: { score: number | null; count: number }) {
  const { t } = useResultsT();
  const format = useFormatters();
  return (
    <span className="font-body text-body-sm text-foreground">
      {score === null
        ? t('results.hotels.noReviews')
        : t('results.hotels.review', { score: format.number(score), count })}
    </span>
  );
}

export function HotelCard({ hotel, nights, href }: { hotel: Hotel; nights: number; href: string }) {
  const { t } = useResultsT();
  const format = useFormatters();
  const headingId = useId();
  const rate = hotel.cheapestRate;
  return (
    <Card asChild interactive>
      <article
        aria-labelledby={headingId}
        className="flex flex-col gap-4 p-4 md:flex-row md:justify-between"
        data-testid="hotel-result"
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="font-heading text-h4 font-bold text-heading">
              {hotel.name}
            </h3>
            {hotel.supplier === 'mock' ? (
              <Badge variant="neutral">{t('results.demoBadge')}</Badge>
            ) : null}
          </div>
          <Stars count={hotel.stars} />
          <p className="flex items-center gap-1 font-body text-body-sm text-foreground">
            <MapPin aria-hidden="true" className="size-4" />
            {[hotel.area, hotel.cityName].filter(Boolean).join(', ')}
          </p>
          <ReviewScore score={hotel.reviewScore} count={hotel.reviewCount} />
          <p className="font-body text-body-sm text-foreground">
            {rate.roomName} · {t(`results.boards.${rate.board}`)}
          </p>
          {rate.refundable ? (
            <Badge variant="success" className="self-start">
              {rate.freeCancellationUntil
                ? t('results.hotels.freeCancellationUntil', {
                    date: format.date(rate.freeCancellationUntil, 'medium'),
                  })
                : t('results.hotels.freeCancellation')}
            </Badge>
          ) : hotel.freeCancellationAvailable ? (
            <Badge variant="info" className="self-start">
              {t('results.hotels.freeCancellation')}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 md:items-end md:justify-end">
          <p className="flex flex-col md:items-end">
            <span className="font-heading text-h3 font-extrabold text-heading">
              {format.money(rate.price.total)}
            </span>
            <span className="font-body text-caption text-foreground">
              {t('results.hotels.total', { count: nights })} ·{' '}
              {t('results.hotels.perNight', { price: format.money(rate.pricePerNight) })}
            </span>
            {rate.payAtProperty ? (
              <span className="font-body text-caption text-foreground">
                {t('results.hotels.payAtProperty', { amount: format.money(rate.payAtProperty) })}
              </span>
            ) : null}
          </p>
          <Button asChild>
            <AppLink
              href={href}
              aria-label={t('results.hotels.seeRoomsLabel', { hotel: hotel.name })}
            >
              {t('results.hotels.seeRooms')}
            </AppLink>
          </Button>
        </div>
      </article>
    </Card>
  );
}
