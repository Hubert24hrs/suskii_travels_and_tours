import { I18nProvider } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppLink } from '../../components/app-link';
import { CarsHeader } from '../../components/cars/cars-header';
import { Container } from '../../components/layout/container';
import { PartnerOffers } from '../../components/partners/partner-offers';
import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

const PRODUCTS = [
  { key: 'buses', href: '/buses' },
  { key: 'rides', href: '/rides' },
  { key: 'rentals', href: '/rentals' },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('cars.hub.title'),
    description: t('cars.hub.body'),
    path: '/cars',
  });
}

/**
 * Buses, rides and car rental in one place: the Cars products that are switched on, and car rental
 * and airport transfers from affiliate partners (ADR-069) when partner offers are on.
 */
export default async function CarsPage() {
  const { t, locale, currency, messages } = await getI18n();
  const [features, partnersOn] = await Promise.all([api.carsFeatures(), api.partnerOffersOn()]);
  const products = PRODUCTS.filter((product) => features?.[product.key]);
  if (products.length === 0 && !partnersOn) notFound();
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <CarsHeader
        heading={t('cars.hub.heading')}
        body={t('cars.hub.body')}
        trail={[{ name: t('cars.hub.title'), path: '/cars' }]}
      />
      <ul className="grid gap-4 md:grid-cols-3">
        {products.map((product) => (
          <li key={product.key}>
            <Card interactive className="relative flex h-full flex-col gap-3 p-6">
              <h2 className="font-heading text-h3 font-bold text-heading">
                <AppLink
                  href={product.href}
                  className="after:absolute after:inset-0 focus-visible:focus-ring"
                >
                  {t(`cars.hub.${product.key}.title`)}
                </AppLink>
              </h2>
              <p className="font-body text-body text-foreground">
                {t(`cars.hub.${product.key}.body`)}
              </p>
              <p className="mt-auto font-body text-body font-bold text-primary">
                {t(`cars.hub.${product.key}.cta`)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {partnersOn ? (
        <I18nProvider locale={locale} messages={{ partners: messages.partners }}>
          <PartnerOffers
            source={{
              kind: 'place',
              countryCode: 'NG',
              categories: ['car_rental', 'transfer'],
              currency,
            }}
            heading={t('partners.hubHeading')}
            testId="partner-offers-hub"
          />
        </I18nProvider>
      ) : null}
    </Container>
  );
}
