import { DestinationCard } from '@suskii/ui-web';
import Image from 'next/image';

import type { HotelDestination } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';
import { CityArt } from '../art/city-art';

export async function DestinationCards({
  destinations,
  headingLevel = 'h3',
}: {
  destinations: HotelDestination[];
  headingLevel?: 'h2' | 'h3';
}) {
  const { t, format } = await getI18n();
  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {destinations.map((destination) => (
        <li key={destination.id}>
          <DestinationCard
            href={`/hotels/${destination.slug}`}
            linkComponent={AppLink}
            headingLevel={headingLevel}
            media={
              destination.imageUrl ? (
                <Image
                  src={destination.imageUrl}
                  alt=""
                  width={640}
                  height={480}
                  sizes="(min-width: 768px) 33vw, 50vw"
                />
              ) : (
                <CityArt city={destination.city.name} />
              )
            }
            city={destination.city.name}
            country={destination.country.name}
            hotelsLabel={
              destination.hotelCount !== null
                ? t('common.hotels', { count: destination.hotelCount })
                : t('sections.destinations.noPrice')
            }
            priceLabel={
              destination.fromPricePerNight
                ? t('common.fromPricePerNight', {
                    price: format.moneyFrom(destination.fromPricePerNight),
                  })
                : undefined
            }
            statusLabel={destination.sample ? t('common.sampleRate') : undefined}
          />
        </li>
      ))}
    </ul>
  );
}
