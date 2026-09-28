import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

import type { LinkComponent } from './link';

export interface DestinationCardProps {
  href: string;
  linkComponent?: LinkComponent;
  /** Landscape image element. Decorative: give it empty alt text. */
  media: ReactNode;
  city: string;
  country: string;
  /** e.g. "248 hotels". */
  hotelsLabel: string;
  /** e.g. "from ₦45,000/night". */
  priceLabel: string;
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
}

/** Whole card is one link. Text sits on a solid dark scrim that keeps AA contrast on any photo. */
export function DestinationCard({
  href,
  linkComponent: LinkElement = 'a',
  media,
  city,
  country,
  hotelsLabel,
  priceLabel,
  headingLevel: Heading = 'h3',
  className,
}: DestinationCardProps) {
  return (
    <LinkElement
      href={href}
      className={cn(
        'group relative block overflow-hidden rounded-lg focus-visible:focus-ring',
        'transition-shadow duration-base ease-standard md:hover:shadow-card-hover',
        className,
      )}
    >
      <div className="aspect-4/3 bg-skeleton *:size-full *:object-cover">{media}</div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-scrim p-4 text-on-scrim">
        <Heading className="font-heading text-h4 font-bold">
          {city}
          <span className="sr-only">, </span>
          <span className="block font-body text-body-sm font-medium">{country}</span>
        </Heading>
        <p className="font-body text-body-sm">
          {hotelsLabel} · {priceLabel}
        </p>
      </div>
    </LinkElement>
  );
}
