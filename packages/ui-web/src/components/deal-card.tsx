import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

import { Badge } from './badge';
import { buttonVariants } from './button';
import { Card } from './card';
import type { LinkComponent } from './link';

export interface DealCardProps {
  /** Pre-filled search URL. */
  href: string;
  linkComponent?: LinkComponent;
  /** 16:9 image element (e.g. next/image). Decorative: give it empty alt text. */
  media: ReactNode;
  originCode: string;
  destinationCode: string;
  /** Screen-reader route, e.g. "Lagos to London". */
  routeLabel: string;
  airlineName: string;
  airlineLogo?: ReactNode;
  /** Formatted travel dates. */
  dates: string;
  cabin: string;
  /** Formatted price with its qualifier, e.g. "from ₦450,000". */
  priceLabel: string;
  /** Optional savings badge, e.g. "-15%". */
  discountLabel?: string | undefined;
  /** Optional neutral status badge, e.g. "Sample fare" for mock supplier quotes (guardrails). */
  statusLabel?: string | undefined;
  /** Freshness of the quote, e.g. "Updated 2 hours ago" (required by the pricing guardrails). */
  updatedLabel: string;
  ctaLabel: string;
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
}

export function DealCard({
  href,
  linkComponent: LinkElement = 'a',
  media,
  originCode,
  destinationCode,
  routeLabel,
  airlineName,
  airlineLogo,
  dates,
  cabin,
  priceLabel,
  discountLabel,
  statusLabel,
  updatedLabel,
  ctaLabel,
  headingLevel: Heading = 'h3',
  className,
}: DealCardProps) {
  return (
    <Card asChild interactive className={cn('flex flex-col overflow-hidden', className)}>
      <article>
        <div className="aspect-video overflow-hidden bg-skeleton *:size-full *:object-cover">
          {media}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <Heading className="font-heading text-h4 font-bold text-heading">
              <span aria-hidden="true">
                {originCode} → {destinationCode}
              </span>
              <span className="sr-only">{routeLabel}</span>
            </Heading>
            {discountLabel || statusLabel ? (
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {statusLabel ? <Badge variant="neutral">{statusLabel}</Badge> : null}
                {discountLabel ? <Badge variant="promo">{discountLabel}</Badge> : null}
              </div>
            ) : null}
          </div>
          <p className="flex items-center gap-2 font-body text-body-sm text-foreground">
            {airlineLogo ? (
              <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">
                {airlineLogo}
              </span>
            ) : null}
            {airlineName}
          </p>
          <p className="font-body text-body-sm text-muted">
            {dates} · {cabin}
          </p>
          <p className="font-heading text-h3 font-extrabold text-primary">{priceLabel}</p>
          <p className="font-body text-caption text-muted">{updatedLabel}</p>
          <LinkElement
            href={href}
            className={cn(buttonVariants({ variant: 'secondary', fullWidth: true }), 'mt-2')}
          >
            {ctaLabel}
          </LinkElement>
        </div>
      </article>
    </Card>
  );
}
