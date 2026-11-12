import type { Metadata } from 'next';

import { CityHub, loadHub } from '../../../../components/seo/city-hub';
import { getI18n } from '../../../../lib/i18n';
import { pageMetadata } from '../../../../lib/seo';

interface Props {
  params: Promise<{ city: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  const { city } = await params;
  const hub = await loadHub(city, 'to');
  if (!hub) return {};
  const name = hub.data.city.name;
  return pageMetadata({
    title: t('pages.hub.toTitle', { city: name }),
    description: t('pages.hub.toDescription', { city: name }),
    path: `/flights/to/${hub.data.city.slug}`,
  });
}

/** City hub (ADR-080): popular routes to the city, with their fares. */
export default async function FlightsHubPage({ params }: Props) {
  const { city } = await params;
  return <CityHub slug={city} side="to" />;
}
