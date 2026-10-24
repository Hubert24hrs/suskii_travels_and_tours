import { Badge, Button, Card, Input } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppLink } from '../../components/app-link';
import { CarsHeader } from '../../components/cars/cars-header';
import { Container } from '../../components/layout/container';
import { CheckboxField, NativeSelect } from '../../components/search/native-select';
import { api } from '../../lib/api';
import { rentalQuery } from '../../lib/cars-query';
import { getI18n } from '../../lib/i18n';
import type { SearchParams } from '../../lib/search-initial';
import { pageMetadata } from '../../lib/seo';

const CATEGORIES = ['economy', 'compact', 'suv', 'luxury', 'van'] as const;

interface Props {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('cars.rentals.title'),
    description: t('cars.rentals.description'),
    path: '/rentals',
    noIndex: Object.keys(await searchParams).length > 0,
  });
}

/**
 * Car rental (ADR-049): a GET search by city and period (branch local times), then the cars
 * free for the whole period with the rental estimate and the refundable deposit.
 */
export default async function RentalsPage({ searchParams }: Props) {
  const { t, format } = await getI18n();
  const params = await searchParams;
  const query = rentalQuery(params);
  const features = await api.carsFeatures();
  if (!features?.rentals) notFound();
  const results = query
    ? await api.rentalSearch({
        city: query.city,
        pickupAt: query.pickupAt,
        returnAt: query.returnAt,
        category: query.category,
        chauffeur: String(query.chauffeur),
      })
    : null;
  const value = (key: string): string => {
    const raw = params[key];
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };
  const carry = query
    ? `?pickupAt=${encodeURIComponent(query.pickupAt)}&returnAt=${encodeURIComponent(query.returnAt)}${query.chauffeur ? '&chauffeur=true' : ''}`
    : '';

  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <CarsHeader
        heading={t('cars.rentals.heading')}
        body={t('cars.rentals.body')}
        trail={[
          { name: t('cars.hub.title'), path: '/cars' },
          { name: t('cars.rentals.title'), path: '/rentals' },
        ]}
      />
      <Card asChild className="p-4">
        <form
          method="get"
          action="/rentals"
          className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6 lg:items-end"
        >
          <Input
            id="rental-city"
            name="city"
            label={t('cars.rentals.city')}
            defaultValue={value('city') || 'Lagos'}
            required
          />
          <Input
            id="rental-pickup"
            name="pickupAt"
            type="datetime-local"
            label={t('cars.rentals.pickupAt')}
            defaultValue={value('pickupAt')}
            required
          />
          <Input
            id="rental-return"
            name="returnAt"
            type="datetime-local"
            label={t('cars.rentals.returnAt')}
            defaultValue={value('returnAt')}
            required
          />
          <NativeSelect
            id="rental-category"
            name="category"
            label={t('cars.rentals.category')}
            options={[
              { value: '', label: t('cars.rentals.anyCategory') },
              ...CATEGORIES.map((category) => ({
                value: category,
                label: t(`cars.rentals.categories.${category}`),
              })),
            ]}
            defaultValue={value('category')}
          />
          <CheckboxField
            name="chauffeur"
            value="true"
            label={t('cars.rentals.chauffeur')}
            defaultChecked={value('chauffeur') === 'true'}
          />
          <Button type="submit">{t('cars.rentals.search')}</Button>
        </form>
      </Card>

      {query ? (
        <section aria-labelledby="rental-results" className="flex flex-col gap-4">
          <h2 id="rental-results" className="font-heading text-h3 font-bold text-heading">
            {t('cars.rentals.results', { count: results?.vehicles.length ?? 0 })}
          </h2>
          {!results || results.vehicles.length === 0 ? (
            <p role="status" className="font-body text-body text-foreground">
              {t('cars.rentals.noResults')}
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="rental-cars">
              {results.vehicles.map((car) => (
                <li key={car.id}>
                  <Card interactive className="relative flex h-full flex-col gap-2 p-4">
                    <h3 className="font-heading text-h4 font-bold text-heading">
                      <AppLink
                        href={`/rentals/${car.slug}${carry}`}
                        className="after:absolute after:inset-0 focus-visible:focus-ring"
                      >
                        {car.make} {car.model}
                      </AppLink>
                    </h3>
                    <p className="font-body text-caption text-muted">
                      {[
                        t(`cars.rentals.categories.${car.category}`),
                        t(`cars.rentals.transmissions.${car.transmission}`),
                        t('cars.rentals.seats', { count: car.seats }),
                        car.branch.name,
                      ].join(' · ')}
                    </p>
                    {car.sample ? (
                      <Badge variant="neutral" className="self-start">
                        {t('cars.sample')}
                      </Badge>
                    ) : null}
                    <p className="mt-auto font-body text-body font-bold text-heading">
                      {t('cars.rentals.estimate', {
                        price: format.money(car.estimate.rental),
                        days: t('cars.rentals.days', { count: results.days }),
                      })}
                    </p>
                    <p className="font-body text-body-sm text-foreground">
                      {t('cars.rentals.deposit', { price: format.money(car.estimate.deposit) })}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="font-body text-body text-foreground">{t('cars.rentals.enterDates')}</p>
      )}
    </Container>
  );
}
