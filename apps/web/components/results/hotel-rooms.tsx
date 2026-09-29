'use client';

import type { CurrencyCode } from '@suskii/shared/lite';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-web';
import { MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { ReviewScore, Stars } from './hotel-card';
import { ResultsLoading, ResultsMessage } from './result-states';
import { useResultsT } from './results-messages';

type Hotel = Schemas['HotelDetail'];
type Rate = Hotel['rates'][number];
type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; hotel: Hotel }
  | { kind: 'gone' }
  | { kind: 'expired' }
  | { kind: 'error' };
type Notice =
  | { rateId: string; kind: 'gone' }
  | { rateId: string; kind: 'priceChanged'; previous: string; current: string; quoteId: string };

/** One hotel of a search with every rate, cancellation terms and charges paid at the hotel. */
export function HotelRooms({
  hotelId,
  currency,
  backHref,
}: {
  hotelId: string;
  currency: CurrencyCode;
  backHref: string;
}) {
  const { t } = useResultsT();
  const format = useFormatters();
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; phase: Phase } | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectError, setSelectError] = useState(false);
  const key = JSON.stringify([hotelId, currency, attempt]);
  const phase: Phase = loaded?.key === key ? loaded.phase : { kind: 'loading' };

  useEffect(() => {
    let cancelled = false;
    const [id, hotelCurrency] = JSON.parse(key) as [string, CurrencyCode];
    browserApi()
      .GET('/v1/hotels/results/{hotelId}', {
        params: { path: { hotelId: id }, query: { currency: hotelCurrency } },
      })
      .then(({ data, response }) => {
        if (cancelled) return;
        setLoaded({
          key,
          phase: data
            ? { kind: 'ready', hotel: data }
            : response.status === 410
              ? { kind: 'expired' }
              : response.status === 404 || response.status === 400
                ? { kind: 'gone' }
                : { kind: 'error' },
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, phase: { kind: 'error' } });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const select = async (rate: Rate) => {
    setSelecting(rate.id);
    setNotice(null);
    setSelectError(false);
    try {
      const { data, response } = await browserApi().POST('/v1/hotels/rates/{rateId}/quote', {
        params: { path: { rateId: rate.id }, query: { currency } },
      });
      if (data?.priceChange) {
        setNotice({
          rateId: rate.id,
          kind: 'priceChanged',
          previous: format.money(data.priceChange.previous),
          current: format.money(data.priceChange.current),
          quoteId: data.quoteId,
        });
      } else if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      } else if (response.status === 410) {
        setNotice({ rateId: rate.id, kind: 'gone' });
      } else {
        setSelectError(true);
      }
    } catch {
      setSelectError(true);
    }
    setSelecting(null);
  };

  if (phase.kind === 'loading') return <ResultsLoading label={t('common.loading')} />;
  if (phase.kind === 'error')
    return (
      <ResultsMessage
        tone="alert"
        action={t('results.retry')}
        onAction={() => setAttempt((n) => n + 1)}
      >
        {t('results.error')}
      </ResultsMessage>
    );
  if (phase.kind === 'expired' || phase.kind === 'gone')
    return (
      <Card role="status" className="flex flex-col items-start gap-4 p-6">
        <p className="font-body text-body text-foreground">
          {phase.kind === 'expired' ? t('results.expired') : t('results.offerGone')}
        </p>
        <Button asChild variant="secondary">
          <AppLink href={backHref}>{t('results.searchAgain')}</AppLink>
        </Button>
      </Card>
    );

  const { hotel } = phase;
  const amenity = (code: string) => {
    const key = `results.amenities.${code}`;
    const label = t(key as Parameters<typeof t>[0]);
    return label === key ? code.replaceAll('_', ' ') : label;
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-h2 font-extrabold text-heading">{hotel.name}</h1>
          {hotel.supplier === 'mock' ? (
            <Badge variant="neutral">{t('results.demoBadge')}</Badge>
          ) : null}
        </div>
        <Stars count={hotel.stars} />
        <p className="flex items-center gap-1 font-body text-body text-foreground">
          <MapPin aria-hidden="true" className="size-4" />
          {[hotel.area, hotel.cityName].filter(Boolean).join(', ')}
        </p>
        <ReviewScore score={hotel.reviewScore} count={hotel.reviewCount} />
      </header>
      {hotel.amenities.length > 0 ? (
        <section aria-labelledby="hotel-amenities" className="flex flex-col gap-2">
          <h2 id="hotel-amenities" className="font-heading text-h4 font-bold text-heading">
            {t('results.hotels.amenities')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {hotel.amenities.map((code) => (
              <li key={code}>
                <Badge variant="neutral">{amenity(code)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="hotel-rooms" className="flex flex-col gap-4">
        <h2 id="hotel-rooms" className="font-heading text-h3 font-bold text-heading">
          {t('results.hotels.rooms')}
        </h2>
        {selectError ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {t('results.error')}
          </p>
        ) : null}
        <ol className="flex flex-col gap-4">
          {hotel.rates.map((rate) => {
            const price = format.money(rate.price.total);
            const rateNotice = notice?.rateId === rate.id ? notice : null;
            return (
              <li key={rate.id}>
                <Card className="flex flex-col gap-3 p-4" data-testid="hotel-rate">
                  <div className="flex flex-col gap-3 md:flex-row md:justify-between">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-heading text-body font-bold text-heading">
                        {rate.roomName}
                      </h3>
                      <p className="font-body text-body-sm text-foreground">
                        {t(`results.boards.${rate.board}`)}
                      </p>
                      {rate.refundable ? (
                        <Badge variant="success" className="self-start">
                          {rate.freeCancellationUntil
                            ? t('results.hotels.freeCancellationUntil', {
                                date: format.date(rate.freeCancellationUntil, 'medium'),
                              })
                            : t('results.hotels.freeCancellation')}
                        </Badge>
                      ) : (
                        <Badge variant="neutral" className="self-start">
                          {t('results.hotels.nonRefundable')}
                        </Badge>
                      )}
                      {rate.payAtProperty ? (
                        <p className="font-body text-caption text-foreground">
                          {t('results.hotels.payAtProperty', {
                            amount: format.money(rate.payAtProperty),
                          })}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 md:items-end">
                      <p className="flex flex-col md:items-end">
                        <span className="font-heading text-h3 font-extrabold text-heading">
                          {price}
                        </span>
                        <span className="font-body text-caption text-foreground">
                          {t('results.hotels.total', { count: hotel.nights })} ·{' '}
                          {t('results.hotels.perNight', {
                            price: format.money(rate.pricePerNight),
                          })}
                        </span>
                      </p>
                      <Button
                        onClick={() => void select(rate)}
                        loading={selecting === rate.id}
                        disabled={selecting !== null && selecting !== rate.id}
                        aria-label={t('results.hotels.selectLabel', {
                          room: rate.roomName,
                          board: t(`results.boards.${rate.board}`),
                          price,
                        })}
                      >
                        {t('results.hotels.select')}
                      </Button>
                    </div>
                  </div>
                  {rateNotice ? (
                    <div
                      role="alert"
                      className="flex flex-col gap-3 rounded-md bg-primary-subtle p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <p className="font-body text-body-sm text-foreground">
                        {rateNotice.kind === 'gone'
                          ? t('results.offerGone')
                          : t('results.priceChanged', {
                              previous: rateNotice.previous,
                              current: rateNotice.current,
                            })}
                      </p>
                      {rateNotice.kind === 'priceChanged' ? (
                        <Button
                          variant="secondary"
                          onClick={() => router.push(`/checkout/${rateNotice.quoteId}`)}
                        >
                          {t('results.continueAtPrice', { price: rateNotice.current })}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
