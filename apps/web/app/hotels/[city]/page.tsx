import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';

import { CityArt } from '../../../components/art/city-art';
import { Breadcrumbs } from '../../../components/breadcrumbs';
import { Container } from '../../../components/layout/container';
import { EMPTY_HOTEL_STATE } from '../../../components/search/form-state';
import { SearchPanel } from '../../../components/search/search-panel';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

interface Props {
  params: Promise<{ city: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, currency } = await getI18n();
  const { city } = await params;
  const data = await api.hotelDestination(city, currency);
  if (!data) return {};
  return pageMetadata({
    title: t('pages.city.title', { city: data.city.name }),
    description: t('pages.city.description', { city: data.city.name, country: data.country.name }),
    path: `/hotels/${data.slug}`,
  });
}

/** Programmatic SEO page for a hotel destination, with the latest cached nightly price. */
export default async function CityPage({ params }: Props) {
  const { t, format, currency } = await getI18n();
  const { city } = await params;
  const [data, destinations] = await Promise.all([
    api.hotelDestination(city, currency),
    api.hotelDestinations(currency),
  ]);
  if (!data) notFound();
  return (
    <>
      <Container className="flex flex-col gap-4 pt-6 pb-8">
        <Breadcrumbs
          items={[
            { name: t('verticals.hotels'), path: '/hotels' },
            { name: t('pages.city.title', { city: data.city.name }), path: `/hotels/${data.slug}` },
          ]}
        />
        <div className="grid items-center gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
              {t('pages.city.heading', { city: data.city.name })}
            </h1>
            <p className="font-body text-body text-foreground">
              {data.hotelCount !== null && data.fromPricePerNight
                ? t('pages.city.summary', {
                    hotels: t('common.hotels', { count: data.hotelCount }),
                    price: format.moneyFrom(data.fromPricePerNight),
                  })
                : t('pages.city.noPrice', { city: data.city.name })}
            </p>
            {data.sample ? (
              <p className="font-body text-caption text-muted">{t('common.sampleRate')}</p>
            ) : null}
          </div>
          <div className="aspect-video overflow-hidden rounded-xl *:size-full *:object-cover">
            {data.imageUrl ? (
              <Image
                src={data.imageUrl}
                alt=""
                width={960}
                height={540}
                sizes="(min-width: 1024px) 50vw, 100vw"
              />
            ) : (
              <CityArt city={data.city.name} />
            )}
          </div>
        </div>
      </Container>
      <section aria-labelledby="city-search">
        <Container>
          <h2 id="city-search" className="mb-4 font-heading text-h3 font-bold text-heading">
            {t('pages.city.searchCta', { city: data.city.name })}
          </h2>
        </Container>
        <SearchPanel
          defaultTab="hotels"
          overlap={false}
          destinations={destinations?.destinations ?? []}
          initial={{
            hotels: {
              ...EMPTY_HOTEL_STATE,
              city: { id: data.city.id, name: data.city.name, countryName: data.country.name },
            },
          }}
        />
      </section>
    </>
  );
}
