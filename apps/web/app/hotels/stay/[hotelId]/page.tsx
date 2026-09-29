import { I18nProvider } from '@suskii/i18n/react';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AppLink } from '../../../../components/app-link';
import { Container } from '../../../../components/layout/container';
import { HotelRooms } from '../../../../components/results/hotel-rooms';
import { pickResultsMessages } from '../../../../components/results/pick-results-messages';
import { getI18n } from '../../../../lib/i18n';
import type { SearchParams } from '../../../../lib/search-initial';
import { pageMetadata } from '../../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('results.hotels.rooms'),
    description: t('pages.verticals.hotels.body'),
    path: '/hotels/search',
    noIndex: true,
  });
}

function queryString(query: SearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item);
    }
  }
  return params.toString();
}

/** A hotel from a search, with its rooms and rates. Search results are private: never indexed. */
export default async function HotelStayPage({
  params,
  searchParams,
}: {
  params: Promise<{ hotelId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { t, locale, currency, messages } = await getI18n();
  const { hotelId } = await params;
  const backHref = `/hotels/search?${queryString(await searchParams)}`;
  return (
    <Container className="flex flex-col gap-6 pt-8 pb-16">
      <AppLink
        href={backHref}
        className="inline-flex items-center gap-2 self-start font-body text-body-sm font-bold text-primary focus-visible:focus-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('results.hotels.backToResults')}
      </AppLink>
      <I18nProvider locale={locale} messages={pickResultsMessages(messages)}>
        <Suspense>
          <HotelRooms
            hotelId={decodeURIComponent(hotelId)}
            currency={currency}
            backHref={backHref}
          />
        </Suspense>
      </I18nProvider>
    </Container>
  );
}
