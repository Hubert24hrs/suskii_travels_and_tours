import { I18nProvider } from '@suskii/i18n/react';
import { Badge, Card } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BookRental } from '../../../components/cars/book-rental';
import { pickCarsMessages } from '../../../components/cars/cars-messages';
import { CarsHeader } from '../../../components/cars/cars-header';
import { Container } from '../../../components/layout/container';
import { ProductReviews } from '../../../components/reviews/product-reviews';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import type { SearchParams } from '../../../lib/search-initial';
import { pageMetadata } from '../../../lib/seo';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  const { slug } = await params;
  const car = await api.rentalVehicle(slug);
  return pageMetadata({
    title: car ? `${car.make} ${car.model}` : t('cars.rentals.title'),
    description: t('cars.rentals.description'),
    path: `/rentals/${slug}`,
  });
}

/** One car: rates, policies, deposit and the booking form. */
export default async function RentalVehiclePage({ params, searchParams }: Props) {
  const { t, format, locale, messages } = await getI18n();
  const { slug } = await params;
  const query = await searchParams;
  const car = await api.rentalVehicle(slug);
  if (!car) notFound();
  const places = car.delivery ? ((await api.ridePlaces(car.cityName))?.places ?? []) : [];
  const pickupAt = first(query.pickupAt);
  const returnAt = first(query.returnAt);
  const line = 'font-body text-body-sm text-foreground';
  const heading = 'pt-2 font-heading text-h4 font-bold text-heading';
  const countries = car.crossBorder
    ? format.list(car.crossBorder.countries.map((code) => format.country(code)))
    : '';

  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <CarsHeader
        heading={`${car.make} ${car.model} (${car.year})`}
        body={[
          t(`cars.rentals.categories.${car.category}`),
          t(`cars.rentals.transmissions.${car.transmission}`),
          t('cars.rentals.seats', { count: car.seats }),
        ].join(' · ')}
        trail={[
          { name: t('cars.rentals.title'), path: '/rentals' },
          { name: `${car.make} ${car.model}`, path: `/rentals/${car.slug}` },
        ]}
      />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {car.sample ? (
            <p className="flex items-center gap-2 font-body text-body-sm text-foreground">
              <Badge variant="neutral">{t('cars.sample')}</Badge>
              {t('cars.sampleNote')}
            </p>
          ) : null}
          <Card className="flex flex-col gap-2 p-4">
            <p className="font-body text-body font-bold text-heading">
              {t('cars.rentals.perDay', { price: format.money(car.daily) })}
            </p>
            {car.weekly ? (
              <p className={line} data-testid="rental-weekly">
                {t('cars.rentals.perWeek', { price: format.money(car.weekly) })}
              </p>
            ) : null}
            {car.monthly ? (
              <p className={line} data-testid="rental-monthly">
                {t('cars.rentals.perMonth', { price: format.money(car.monthly) })}
              </p>
            ) : null}
            <p className="font-body text-caption text-muted">{t('cars.rentals.detail.longTerm')}</p>
            <p className={line}>
              {car.chauffeurDaily
                ? t('cars.rentals.detail.chauffeurDaily', {
                    price: format.money(car.chauffeurDaily),
                  })
                : t('cars.rentals.detail.noChauffeur')}
            </p>
            {car.delivery ? (
              <p className={line}>
                {t('cars.rentals.detail.delivery', {
                  km: car.delivery.maxKm,
                  price: format.money(car.delivery.perKm),
                })}
              </p>
            ) : null}
            <p className={line}>
              {t('cars.rentals.deposit', { price: format.money(car.deposit) })}
            </p>
            <p className="font-body text-caption text-muted">
              {t('cars.rentals.detail.depositNote')}
            </p>
          </Card>
          <Card asChild className="flex flex-col gap-2 p-4">
            <dl>
              <dt className="font-heading text-h4 font-bold text-heading">
                {t('cars.rentals.detail.branch')}
              </dt>
              <dd className={line}>
                {car.branch.name}, {car.branch.address}
                {car.branch.airportCode ? (
                  <>
                    {' '}
                    <Badge variant="neutral" data-testid="rental-airport">
                      {t('cars.rentals.detail.airportBranch', { code: car.branch.airportCode })}
                    </Badge>
                  </>
                ) : null}
              </dd>
              <dt className={heading}>{t('cars.rentals.driverAge')}</dt>
              <dd className={line} data-testid="rental-min-age">
                {t('cars.rentals.detail.minDriverAge', { age: car.minDriverAge })}
              </dd>
              {car.extras.length > 0 ? (
                <>
                  <dt className={heading}>{t('cars.rentals.detail.extrasHeading')}</dt>
                  <dd>
                    <ul className="flex flex-col gap-1" data-testid="rental-extras">
                      {car.extras.map((extra) => (
                        <li key={extra.code} className={line}>
                          {t('cars.rentals.detail.extraPrice', {
                            name: t(`booking.cars.rental.extraNames.${extra.code}`),
                            price: format.money(extra.daily),
                          })}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              ) : null}
              <dt className={heading}>{t('cars.rentals.detail.crossBorderHeading')}</dt>
              <dd className={line} data-testid="rental-cross-border">
                {car.crossBorder
                  ? t('cars.rentals.detail.crossBorder', {
                      countries,
                      price: format.money(car.crossBorder.fee),
                    })
                  : t('cars.rentals.detail.noCrossBorder')}
              </dd>
              {car.returnBranches.length > 0 ? (
                <>
                  <dt className={heading}>{t('cars.rentals.detail.returnHeading')}</dt>
                  <dd>
                    <ul className="flex flex-col gap-1" data-testid="rental-return-branches">
                      {car.returnBranches.map((branch) => (
                        <li key={branch.code} className={line}>
                          {t('cars.rentals.detail.returnBranch', {
                            name: branch.name,
                            price: format.money(branch.fee),
                          })}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              ) : null}
              <dt className="pt-2 font-heading text-h4 font-bold text-heading">
                {t('cars.rentals.detail.mileage')}
              </dt>
              <dd className={line}>
                {car.mileage.kmPerDay === null || !car.mileage.excessKm
                  ? t('cars.rentals.detail.unlimited')
                  : t('cars.rentals.detail.kmPerDay', {
                      km: car.mileage.kmPerDay,
                      price: format.money(car.mileage.excessKm),
                    })}
              </dd>
              <dt className="pt-2 font-heading text-h4 font-bold text-heading">
                {t('cars.rentals.detail.fuel')}
              </dt>
              <dd className={line}>{t(`cars.rentals.detail.fuelPolicies.${car.fuelPolicy}`)}</dd>
              {car.insuranceSummary ? (
                <>
                  <dt className="pt-2 font-heading text-h4 font-bold text-heading">
                    {t('cars.rentals.detail.insurance')}
                  </dt>
                  <dd className={line}>{car.insuranceSummary}</dd>
                </>
              ) : null}
              {car.features.length > 0 ? (
                <>
                  <dt className="pt-2 font-heading text-h4 font-bold text-heading">
                    {t('cars.rentals.detail.features')}
                  </dt>
                  <dd className={line}>{format.list(car.features)}</dd>
                </>
              ) : null}
              <dt className="pt-2 font-heading text-h4 font-bold text-heading">
                {t('cars.rentals.detail.cancellation')}
              </dt>
              <dd>
                <ul className="flex flex-col gap-1 font-body text-body-sm text-foreground">
                  {car.cancellationPolicy.map((tier) => (
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
              </dd>
            </dl>
          </Card>
          <p className="font-body text-caption text-muted">
            {t('cars.rentals.detail.licenceNote')}
          </p>
          <ProductReviews
            kind="rental_vehicle"
            id={car.id}
            name={`${car.make} ${car.model} (${car.year})`}
            description={t('cars.rentals.description')}
            path={`/rentals/${car.slug}`}
            sample={car.sample}
          />
        </div>
        <I18nProvider locale={locale} messages={pickCarsMessages(messages)}>
          <BookRental
            vehicleId={car.id}
            slug={car.slug}
            chauffeurOffered={car.chauffeurDaily !== null}
            deliveryPlaces={places}
            minDriverAge={car.minDriverAge}
            extras={car.extras.map((extra) => ({
              code: extra.code,
              label: t('cars.rentals.book.extraOption', {
                name: t(`booking.cars.rental.extraNames.${extra.code}`),
                price: format.money(extra.daily),
              }),
              max: extra.max,
            }))}
            returnBranches={car.returnBranches.map((branch) => ({
              code: branch.code,
              label: t('cars.rentals.book.returnOption', {
                name: branch.name,
                price: format.money(branch.fee),
              }),
            }))}
            crossBorderLabel={
              car.crossBorder
                ? t('cars.rentals.book.crossBorder', {
                    countries,
                    price: format.money(car.crossBorder.fee),
                  })
                : null
            }
            initial={{
              pickupAt: LOCAL.test(pickupAt) ? pickupAt : '',
              returnAt: LOCAL.test(returnAt) ? returnAt : '',
              chauffeur: first(query.chauffeur) === 'true',
              driverAge: /^\d{2}$/.test(first(query.driverAge)) ? first(query.driverAge) : '',
            }}
          />
        </I18nProvider>
      </div>
    </Container>
  );
}
