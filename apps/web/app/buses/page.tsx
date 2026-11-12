import { Badge, Button, Card, Input } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppLink } from '../../components/app-link';
import { CarsHeader } from '../../components/cars/cars-header';
import { Container } from '../../components/layout/container';
import { NativeSelect } from '../../components/search/native-select';
import { api } from '../../lib/api';
import { busQuery, wallTime } from '../../lib/cars-query';
import { getI18n } from '../../lib/i18n';
import type { SearchParams } from '../../lib/search-initial';
import { pageMetadata } from '../../lib/seo';

interface Props {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('cars.buses.title'),
    description: t('cars.buses.description'),
    path: '/buses',
    // A filled-in search is a personal, parameter-driven view.
    noIndex: Object.keys(await searchParams).length > 0,
  });
}

/**
 * Interstate buses (ADR-049): a plain GET search form (no client JavaScript), then departures
 * with seats left and the price per seat for the visitor's currency.
 */
export default async function BusesPage({ searchParams }: Props) {
  const { t, format, currency } = await getI18n();
  const params = await searchParams;
  const query = busQuery(params);
  const [cities, results] = await Promise.all([
    api.busCities(),
    query
      ? api.busSearch({ ...query, seats: String(query.seats), currency })
      : Promise.resolve(null),
  ]);
  // Switched off (or no API): the route answers 404 like the API.
  if (!cities) notFound();
  const options = [
    { value: '', label: t('cars.buses.anyCity') },
    ...cities.cities.map((city) => ({ value: city.name, label: city.name })),
  ];
  const trips = results?.trips ?? [];
  const value = (key: string): string => {
    const raw = params[key];
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };

  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <CarsHeader
        heading={t('cars.buses.heading')}
        body={t('cars.buses.body')}
        trail={[
          { name: t('cars.hub.title'), path: '/cars' },
          { name: t('cars.buses.title'), path: '/buses' },
        ]}
      />
      {cities.cities.length === 0 ? (
        <p role="status" className="font-body text-body text-foreground">
          {t('cars.buses.noCities')}
        </p>
      ) : (
        <Card asChild className="p-4">
          <form
            method="get"
            action="/buses"
            className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end"
          >
            <NativeSelect
              id="bus-from"
              name="from"
              label={t('cars.buses.from')}
              options={options}
              defaultValue={value('from')}
              required
            />
            <NativeSelect
              id="bus-to"
              name="to"
              label={t('cars.buses.to')}
              options={options}
              defaultValue={value('to')}
              required
            />
            <Input
              id="bus-date"
              name="date"
              type="date"
              label={t('cars.buses.date')}
              defaultValue={value('date')}
              required
            />
            <NativeSelect
              id="bus-seats"
              name="seats"
              label={t('cars.buses.seats')}
              options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
              defaultValue={value('seats') || '1'}
            />
            <Button type="submit">{t('cars.buses.search')}</Button>
          </form>
        </Card>
      )}

      {query ? (
        <section aria-labelledby="bus-results" className="flex flex-col gap-4">
          <h2 id="bus-results" className="font-heading text-h3 font-bold text-heading">
            {t('cars.buses.results', { count: trips.length })}
          </h2>
          {trips.length === 0 ? (
            <p role="status" className="font-body text-body text-foreground">
              {t('cars.buses.noResults')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="bus-trips">
              {trips.map((trip) => (
                <li key={trip.id}>
                  <Card
                    interactive
                    className="relative flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex flex-col gap-1">
                      <h3 className="font-heading text-h4 font-bold text-heading">
                        <AppLink
                          href={`/buses/trips/${trip.id}?seats=${query.seats}`}
                          className="after:absolute after:inset-0 focus-visible:focus-ring"
                        >
                          {trip.operator.name}
                        </AppLink>
                      </h3>
                      <p className="font-body text-body text-foreground">
                        <span className="font-bold">{wallTime(trip.departsAtLocal)}</span>{' '}
                        {trip.origin.name} → {trip.destination.name}
                      </p>
                      <p className="font-body text-caption text-muted">
                        {[
                          format.date(trip.departsAtLocal.slice(0, 10), 'weekday'),
                          t('cars.buses.duration', {
                            hours: Math.floor(trip.durationMinutes / 60),
                            minutes: trip.durationMinutes % 60,
                          }),
                          trip.coach,
                          t('cars.buses.seatsLeft', { count: trip.seatsLeft }),
                        ].join(' · ')}
                      </p>
                      {trip.sample ? (
                        <Badge variant="neutral" className="self-start">
                          {t('cars.sample')}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1 md:items-end">
                      <p className="font-body text-body font-bold text-heading">
                        {t('cars.buses.perSeat', { price: format.money(trip.pricePerSeat) })}
                      </p>
                      <p className="font-body text-body-sm font-bold text-primary">
                        {t('cars.buses.chooseSeats')}
                      </p>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </Container>
  );
}
