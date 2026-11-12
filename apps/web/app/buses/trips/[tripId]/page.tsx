import { I18nProvider } from '@suskii/i18n/react';
import { Badge, Card } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { pickCarsMessages } from '../../../../components/cars/cars-messages';
import { CarsHeader } from '../../../../components/cars/cars-header';
import { SeatPicker } from '../../../../components/cars/seat-picker';
import { Container } from '../../../../components/layout/container';
import { ReviewsSection } from '../../../../components/reviews/reviews-section';
import { api } from '../../../../lib/api';
import { amenityLabel, wallTime } from '../../../../lib/cars-query';
import { getI18n } from '../../../../lib/i18n';
import { pageMetadata } from '../../../../lib/seo';

interface Props {
  params: Promise<{ tripId: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  const { tripId } = await params;
  return pageMetadata({
    title: t('cars.buses.trip.title'),
    description: t('cars.buses.description'),
    path: `/buses/trips/${tripId}`,
    // Departures come and go within days: not worth indexing.
    noIndex: true,
  });
}

/** One departure: times, terminals, amenities, the cancellation policy and the seat map. */
export default async function BusTripPage({ params }: Props) {
  const { t, format, currency, locale, messages } = await getI18n();
  const { tripId } = await params;
  if (!UUID.test(tripId)) notFound();
  const trip = await api.busTrip(tripId, currency);
  if (!trip) notFound();
  // The operator's verified reviews; the page is not indexed, so no rating markup.
  const reviews = await api.reviews({ kind: 'bus_operator', ref: trip.operator.id });
  const open = trip.status === 'scheduled';
  const facts = [
    format.date(trip.departsAtLocal.slice(0, 10), 'weekday'),
    t('cars.buses.departs', { time: wallTime(trip.departsAtLocal) }),
    t('cars.buses.duration', {
      hours: Math.floor(trip.durationMinutes / 60),
      minutes: trip.durationMinutes % 60,
    }),
    t('cars.buses.trip.coach', { coach: trip.coach }),
  ];
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <CarsHeader
        heading={t('cars.buses.trip.heading', {
          origin: trip.origin.cityName,
          destination: trip.destination.cityName,
        })}
        body={t('cars.buses.trip.operator', { operator: trip.operator.name })}
        trail={[
          { name: t('cars.buses.title'), path: '/buses' },
          { name: t('cars.buses.trip.title'), path: `/buses/trips/${trip.id}` },
        ]}
      />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {trip.sample ? (
            <p className="flex items-center gap-2 font-body text-body-sm text-foreground">
              <Badge variant="neutral">{t('cars.sample')}</Badge>
              {t('cars.sampleNote')}
            </p>
          ) : null}
          {trip.status === 'cancelled' ? (
            <p role="status" className="font-body text-body text-danger">
              {t('cars.buses.trip.cancelled')}
            </p>
          ) : !open ? (
            <p role="status" className="font-body text-body text-foreground">
              {t('cars.buses.trip.closed')}
            </p>
          ) : null}
          <I18nProvider locale={locale} messages={pickCarsMessages(messages)}>
            <SeatPicker
              tripId={trip.id}
              rows={trip.seatMap.rows}
              currency={currency}
              perSeatLabel={t('cars.buses.perSeat', { price: format.money(trip.pricePerSeat) })}
              open={open}
            />
          </I18nProvider>
          <ReviewsSection page={reviews} />
        </div>
        <Card asChild className="flex flex-col gap-3 p-4">
          <aside aria-label={t('cars.buses.trip.title')}>
            <p className="font-body text-body-sm font-bold text-muted">{facts.join(' · ')}</p>
            <p className="font-body text-body-sm text-foreground">
              {t('cars.buses.trip.terminal', {
                name: trip.origin.name,
                address: trip.origin.address,
              })}
            </p>
            <p className="font-body text-body-sm text-foreground">
              {t('cars.buses.arrives', { time: format.dateTime(trip.arrivesAt, trip.timeZone) })}
              {' · '}
              {trip.destination.name}
            </p>
            <p className="font-body text-body font-bold text-heading">
              {t('cars.buses.perSeat', { price: format.money(trip.pricePerSeat) })}
            </p>
            <p className="font-body text-caption text-muted">
              {t('cars.buses.seatsLeft', { count: trip.seatsLeft })}
            </p>
            {trip.amenities.length > 0 ? (
              <p className="font-body text-body-sm text-foreground">
                {format.list(
                  trip.amenities.map((code) => amenityLabel(messages.cars.buses.amenities, code)),
                )}
              </p>
            ) : null}
            <h2 className="pt-2 font-heading text-h4 font-bold text-heading">
              {t('cars.buses.trip.policy')}
            </h2>
            <ul className="flex flex-col gap-1 font-body text-body-sm text-foreground">
              {trip.cancellationPolicy.map((tier) => (
                <li key={tier.daysBefore}>
                  {tier.refundBps === 0
                    ? t('inhouse.detail.tierNone')
                    : tier.daysBefore === 0
                      ? t('inhouse.detail.tierSameDay', { percent: tier.refundBps / 100 })
                      : t('inhouse.detail.tier', {
                          percent: tier.refundBps / 100,
                          count: tier.daysBefore,
                        })}
                </li>
              ))}
            </ul>
          </aside>
        </Card>
      </div>
    </Container>
  );
}
