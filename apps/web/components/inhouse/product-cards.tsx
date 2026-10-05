import { Badge, Card } from '@suskii/ui-web';
import type { ReactNode } from 'react';

import type { PackageCard, TourCard } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';
import { CityArt } from '../art/city-art';

interface CardProps {
  href: string;
  city: string;
  title: string;
  summary: string;
  meta: string[];
  price: string;
  sampleLabel: string | null;
  headingLevel: 'h2' | 'h3';
}

/** One product: illustration, title, facts and the "from" price; the whole card is the link. */
function ProductCard({
  href,
  city,
  title,
  summary,
  meta,
  price,
  sampleLabel,
  headingLevel: Heading,
}: CardProps): ReactNode {
  return (
    <Card interactive className="relative flex h-full flex-col overflow-hidden">
      <div className="relative aspect-4/3 bg-skeleton">
        <CityArt city={city} />
        {sampleLabel ? (
          <Badge variant="neutral" className="absolute top-3 left-3">
            {sampleLabel}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Heading className="font-heading text-h4 font-bold text-heading">
          <AppLink href={href} className="after:absolute after:inset-0 focus-visible:focus-ring">
            {title}
          </AppLink>
        </Heading>
        <p className="font-body text-body-sm text-foreground">{summary}</p>
        <p className="font-body text-caption text-muted">{meta.join(' · ')}</p>
        <p className="mt-auto font-body text-body font-bold text-heading">{price}</p>
      </div>
    </Card>
  );
}

export async function PackageCards({
  packages,
  headingLevel = 'h3',
  query = '',
}: {
  packages: readonly PackageCard[];
  headingLevel?: 'h2' | 'h3';
  /** Traveller counts to carry to the detail page (`?adults=2`). */
  query?: string;
}) {
  const { t, format } = await getI18n();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="package-cards">
      {packages.map((item) => (
        <li key={item.id}>
          <ProductCard
            href={`/packages/${item.slug}${query}`}
            city={item.cityName}
            title={item.title}
            summary={item.summary}
            meta={[
              `${item.cityName}, ${format.country(item.countryCode)}`,
              t('inhouse.nights', { count: item.nights }),
              t('inhouse.nextDate', { date: format.date(item.nextDeparture, 'medium') }),
            ]}
            price={t('inhouse.fromPerAdult', { price: format.moneyFrom(item.fromPrice) })}
            sampleLabel={item.sample ? t('inhouse.sample') : null}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}

export async function TourCards({
  tours,
  headingLevel = 'h3',
  query = '',
}: {
  tours: readonly TourCard[];
  headingLevel?: 'h2' | 'h3';
  query?: string;
}) {
  const { t, format } = await getI18n();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="tour-cards">
      {tours.map((item) => (
        <li key={item.id}>
          <ProductCard
            href={`/tours/${item.slug}${query}`}
            city={item.cityName}
            title={item.title}
            summary={item.summary}
            meta={[
              `${item.cityName}, ${format.country(item.countryCode)}`,
              t('inhouse.duration', {
                hours: Math.floor(item.durationMinutes / 60),
                minutes: item.durationMinutes % 60,
              }),
              t('inhouse.nextDate', {
                date: `${format.date(item.nextDeparture, 'medium')} ${item.nextDeparture.slice(11, 16)}`,
              }),
            ]}
            price={t('inhouse.fromPerAdult', { price: format.moneyFrom(item.fromPrice) })}
            sampleLabel={item.sample ? t('inhouse.sample') : null}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}
