'use client';

import type { Messages } from '@suskii/i18n';
import { useFormatters, useTranslator } from '@suskii/i18n/react';
import type { CurrencyCode } from '@suskii/shared/lite';
import { Card } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, type Schemas } from '../../lib/browser-api';
import { publicEnv } from '../../lib/env';

type Offers = Schemas['PartnerOffers'];
type Offer = Offers['offers'][number];
type Category = Offer['category'];

/** The catalog subset these offers need; pages pass it through their I18nProvider. */
export type PartnerMessages = Pick<Messages, 'partners'>;

export type PartnerOffersSource =
  | { kind: 'booking'; bookingId: string; currency: CurrencyCode }
  | { kind: 'place'; countryCode: string; categories: readonly Category[]; currency: CurrencyCode };

const LINK =
  'inline-flex min-h-12 items-center justify-center self-start rounded-md border border-border-strong bg-surface px-6 font-body text-body font-bold text-primary focus-visible:focus-ring';

/** The tracked link lives on the API; it records the click and redirects to the partner. */
const partnerUrl = (href: string): string =>
  new URL(href, `${publicEnv.apiBaseUrl.replace(/\/$/, '')}/`).toString();

async function load(source: PartnerOffersSource): Promise<Offers | null> {
  const api = browserApi();
  if (source.kind === 'booking') {
    const { data } = await api.GET('/v1/bookings/{bookingId}/partner-offers', {
      params: { path: { bookingId: source.bookingId }, query: { currency: source.currency } },
      headers: bookingHeaders(source.bookingId),
    });
    return data ?? null;
  }
  const { data } = await api.GET('/v1/partners/offers', {
    params: {
      query: {
        countryCode: source.countryCode,
        categories: source.categories.join(','),
        currency: source.currency,
      },
    },
  });
  return data ?? null;
}

/**
 * Affiliate offers (ADR-069): partner pages for car rental, transfers, eSIMs and insurance, and
 * priced tours. Each opens the partner's site through the API's tracked link, in a new tab; the
 * traveller books and pays there, and the card says so. Renders nothing while the offers load,
 * when partner offers are off (404) or when there are none.
 */
export function PartnerOffers({
  source,
  heading,
  testId,
}: {
  source: PartnerOffersSource;
  heading: string;
  testId: string;
}) {
  const { t } = useTranslator<PartnerMessages>();
  const format = useFormatters();
  const [offers, setOffers] = useState<Offers | null>(null);
  const key = JSON.stringify(source);

  useEffect(() => {
    let cancelled = false;
    load(JSON.parse(key) as PartnerOffersSource)
      .then((data) => {
        if (!cancelled) setOffers(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!offers || offers.offers.length === 0) return null;
  const headingId = `${testId}-heading`;

  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby={headingId} data-testid={testId}>
        <h2 id={headingId} className="font-heading text-h4 font-bold text-heading">
          {heading}
        </h2>
        <p className="font-body text-caption text-foreground">{t('partners.disclosure')}</p>
        <ul className="flex flex-col gap-4">
          {offers.offers.map((offer) => (
            <li
              key={offer.id}
              className="flex flex-col gap-1"
              data-testid={`partner-offer-${offer.programId}`}
            >
              <p className="font-body text-caption font-bold text-muted">
                {t(`partners.category.${offer.category}`)}
                {offer.sample ? ` · ${t('partners.sample')}` : ''}
              </p>
              <p className="font-body text-body font-bold text-foreground">
                {offer.title ?? t(`partners.categoryBody.${offer.category}`)}
              </p>
              {offer.rating || offer.durationMinutes || offer.fromPrice ? (
                <p className="font-body text-body-sm text-foreground">
                  {[
                    offer.fromPrice
                      ? t('partners.from', { price: format.money(offer.fromPrice) })
                      : null,
                    offer.rating
                      ? t('partners.rating', {
                          rating: format.number(offer.rating.average),
                          count: format.number(offer.rating.count),
                        })
                      : null,
                    offer.durationMinutes
                      ? t('partners.hours', {
                          hours: format.number(Math.round(offer.durationMinutes / 30) / 2),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              <a
                href={partnerUrl(offer.href)}
                target="_blank"
                rel="noopener sponsored"
                className={LINK}
              >
                {t('partners.open', { partner: offer.partnerName })}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
