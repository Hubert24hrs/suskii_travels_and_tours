import type { Metadata } from 'next';

import { Breadcrumbs } from '../../components/breadcrumbs';
import { DealsFilter } from '../../components/home/deals-filter';
import { DealCards } from '../../components/home/fresh-flight-offers';
import { Container } from '../../components/layout/container';
import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('pages.deals.title'),
    description: t('pages.deals.body'),
    path: '/deals',
  });
}

/** Every fresh deal, filterable by departure city. */
export default async function DealsPage() {
  const { t, currency } = await getI18n();
  const deals = await api.deals(currency);
  const items = await DealCards({ deals: deals?.deals ?? [] });
  return (
    <Container className="flex flex-col gap-6 py-8">
      <Breadcrumbs items={[{ name: t('pages.deals.title'), path: '/deals' }]} />
      <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
        {t('pages.deals.heading')}
      </h1>
      <p className="max-w-dialog font-body text-body text-foreground">{t('pages.deals.body')}</p>
      {items.length > 0 ? (
        <DealsFilter
          label={t('sections.deals.filterLabel')}
          allLabel={t('sections.deals.allOrigins')}
          origins={deals?.origins ?? []}
          items={items}
          limit={48}
        />
      ) : (
        <p className="font-body text-body text-muted">{t('sections.deals.empty')}</p>
      )}
      <p className="font-body text-caption text-muted">{t('sections.deals.roundTripNote')}</p>
    </Container>
  );
}
