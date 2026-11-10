'use client';

import type { CurrencyCode } from '@suskii/shared/lite';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-web';
import { MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';
import { PartnerOffers } from '../partners/partner-offers';

import { ReviewScore, Stars, VerifiedScore } from './hotel-card';
import { PhotoGallery } from './hotel-photos';
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

/** What the supplier says of the room: who it sleeps, its size and beds, and a description. */
function RoomDetails({ room }: { room: NonNullable<Rate['room']> }) {
  const { t } = useResultsT();
  const format = useFormatters();
  const facts = [
    room.maxGuests ? t('results.stayContent.sleeps', { count: room.maxGuests }) : null,
    room.sizeSqm ? t('results.stayContent.size', { size: format.number(room.sizeSqm) }) : null,
    ...room.beds.map((bed) =>
      t('results.stayContent.bed', {
        count: bed.count,
        type: t(`results.stayContent.bedTypes.${bed.type}`),
      }),
    ),
  ].filter((fact): fact is string => fact !== null);
  if (facts.length === 0 && !room.description) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="room-details">
      {facts.length > 0 ? (
        <p className="font-body text-body-sm text-foreground">{facts.join(' · ')}</p>
      ) : null}
      {room.description ? (
        <p className="font-body text-body-sm text-muted">{room.description}</p>
      ) : null}
    </div>
  );
}

/** One hotel of a search with every rate, cancellation terms and charges paid at the hotel. */
export function HotelRooms({
  hotelId,
  currency,
  backHref,
  photoHosts = [],
  photos = true,
}: {
  hotelId: string;
  currency: CurrencyCode;
  backHref: string;
  /** Hosts a supplier's photographs may come from (`IMAGE_REMOTE_HOSTS`). */
  photoHosts?: readonly string[];
  /** False under the data saver (ADR-075): the page stays text. */
  photos?: boolean;
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
        <div className="flex flex-wrap items-center gap-2">
          <Stars count={hotel.stars} />
          {hotel.propertyType ? (
            <span className="font-body text-body-sm text-foreground" data-testid="property-type">
              {t(`results.propertyTypes.${hotel.propertyType}`)}
            </span>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-body text-foreground">
          <span className="flex items-center gap-1">
            <MapPin aria-hidden="true" className="size-4" />
            {[hotel.area, hotel.cityName].filter(Boolean).join(', ')}
          </span>
          {/* Streets and directions live in a maps app; no map tiles load here (ADR-097). */}
          <a
            href={`https://www.openstreetmap.org/?mlat=${hotel.latitude}&mlon=${hotel.longitude}#map=16/${hotel.latitude}/${hotel.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('results.map.openLabel', { hotel: hotel.name })}
            className="inline-flex min-h-6 items-center font-bold text-primary underline focus-visible:focus-ring"
            data-testid="hotel-open-map"
          >
            {t('results.map.open')}
          </a>
        </p>
        <ReviewScore score={hotel.reviewScore} count={hotel.reviewCount} />
        <VerifiedScore summary={hotel.verifiedReviews} />
      </header>
      {photos ? (
        <PhotoGallery
          hotel={hotel.name}
          photos={hotel.photos}
          hosts={photoHosts}
          sample={hotel.supplier === 'mock'}
        />
      ) : null}
      {hotel.description ? (
        <section aria-labelledby="hotel-about" className="flex flex-col gap-2">
          <h2 id="hotel-about" className="font-heading text-h4 font-bold text-heading">
            {t('results.stayContent.about')}
          </h2>
          <p className="font-body text-body text-foreground" data-testid="hotel-description">
            {hotel.description}
          </p>
        </section>
      ) : null}
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
                      {rate.room ? <RoomDetails room={rate.room} /> : null}
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
      {/* Tours and activities from partners, booked on the partner's site (ADR-069). */}
      <PartnerOffers
        source={{
          kind: 'place',
          countryCode: hotel.countryCode,
          cityName: hotel.cityName,
          categories: ['activity'],
          currency,
        }}
        heading={t('results.discover.thingsToDo', { city: hotel.cityName })}
        testId="hotel-things-to-do"
      />
    </div>
  );
}
