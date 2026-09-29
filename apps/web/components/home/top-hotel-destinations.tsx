import type { HotelDestination } from '../../lib/api';
import { getI18n } from '../../lib/i18n';

import { DestinationCards } from './destination-cards';
import { Section } from './section';

export async function TopHotelDestinations({ destinations }: { destinations: HotelDestination[] }) {
  const { t } = await getI18n();
  if (destinations.length === 0) return null;
  return (
    <Section
      id="destinations"
      title={t('sections.destinations.heading')}
      action={{ href: '/hotels', label: t('sections.destinations.seeAll') }}
    >
      <DestinationCards destinations={destinations} />
    </Section>
  );
}
