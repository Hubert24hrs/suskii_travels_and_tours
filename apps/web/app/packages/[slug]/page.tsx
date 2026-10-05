import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '../../../components/breadcrumbs';
import { BookDeparture } from '../../../components/inhouse/book-departure';
import { pickBookDepartureMessages } from '../../../components/inhouse/book-departure-messages';
import { Itinerary, PolicyTiers, TextList } from '../../../components/inhouse/detail-sections';
import { ProductHeader } from '../../../components/inhouse/product-header';
import { Container } from '../../../components/layout/container';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import { travellerQuery, travellersFrom } from '../../../lib/inhouse-query';
import type { SearchParams } from '../../../lib/search-initial';
import { pageMetadata } from '../../../lib/seo';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { currency } = await getI18n();
  const { slug } = await params;
  const item = await api.package(slug, { currency });
  if (!item) return {};
  return pageMetadata({
    title: item.title,
    description: item.summary,
    path: `/packages/${item.slug}`,
    // Demo inventory is for trying the flow, never for search engines.
    noIndex: item.sample,
  });
}

/** A holiday package: itinerary, what is included, the policy, and its dates to book. */
export default async function PackagePage({ params, searchParams }: Props) {
  const { t, format, currency, locale, messages } = await getI18n();
  const { slug } = await params;
  const travellers = travellersFrom(await searchParams);
  const item = await api.package(slug, { currency, ...travellerQuery(travellers) });
  if (!item) notFound();

  return (
    <Container className="flex flex-col gap-6 pt-6 pb-16">
      <Breadcrumbs
        items={[
          { name: t('verticals.packages'), path: '/packages' },
          { name: item.title, path: `/packages/${item.slug}` },
        ]}
      />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-8 lg:col-span-2">
          <ProductHeader
            title={item.title}
            summary={item.summary}
            city={item.cityName}
            facts={[
              `${item.cityName}, ${format.country(item.countryCode)}`,
              t('inhouse.nights', { count: item.nights }),
            ]}
            sample={item.sample}
          />
          {item.passportRequired ? (
            <p className="font-body text-body text-foreground">
              {t('inhouse.detail.passportRequired')}
            </p>
          ) : null}
          <TextList
            id="detail-highlights"
            title={t('inhouse.detail.highlights')}
            items={item.highlights}
          />
          <Itinerary days={item.itinerary} />
          <TextList
            id="detail-included"
            title={t('inhouse.detail.included')}
            items={item.inclusions}
          />
          <TextList
            id="detail-excluded"
            title={t('inhouse.detail.excluded')}
            items={item.exclusions}
          />
          <PolicyTiers tiers={item.cancellationPolicy} />
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
          <I18nProvider locale={locale} messages={pickBookDepartureMessages(messages)}>
            <BookDeparture
              kind="package"
              currency={currency}
              initialTravellers={travellers}
              departures={item.departures.map((departure) => ({
                id: departure.id,
                label: format.dateRange(departure.startDate, departure.endDate, 'medium'),
                seatsLeft: departure.seatsLeft,
                prices: {
                  adult: format.money(departure.prices.adult),
                  child: departure.prices.child ? format.money(departure.prices.child) : null,
                  infant: departure.prices.infant ? format.money(departure.prices.infant) : null,
                },
              }))}
            />
          </I18nProvider>
          <p className="font-body text-caption text-foreground">{t('inhouse.detail.priceNote')}</p>
          <p className="font-body text-caption text-foreground">
            {t('inhouse.detail.flexiblePayment')}
          </p>
        </aside>
      </div>
    </Container>
  );
}
