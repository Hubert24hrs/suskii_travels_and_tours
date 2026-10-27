import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import type { CurrencyCode } from '@suskii/shared';
import { Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import { Text, View } from 'react-native';

import { appConfig } from '../../config';
import { tripStore } from '../../lib/trips';
import { useApp, useT } from '../../providers/app-provider';

type Offers = Schemas['PartnerOffers'];
type Offer = Offers['offers'][number];
type Category = Offer['category'];

export type PartnerOffersSource =
  | { kind: 'booking'; bookingId: string; currency: CurrencyCode }
  | { kind: 'place'; countryCode: string; categories: readonly Category[]; currency: CurrencyCode };

/**
 * Affiliate offers (ADR-069): partner pages for car rental, transfers, eSIMs and insurance, and
 * priced tours. Each opens the partner's site in the system browser through the API's tracked
 * link (read through `appConfig`, which can change at runtime); the traveller books and pays
 * there, and the card says so. Renders nothing while loading, when partner offers are off (404)
 * or when there are none. Needs the network, so callers hide it offline.
 */
export function PartnerOffers({
  source,
  heading,
  testID,
}: {
  source: PartnerOffersSource;
  heading: string;
  testID: string;
}) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const offers = useQuery({
    queryKey: ['partner-offers', source],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Offers | null> => {
      if (source.kind === 'booking') {
        const { data } = await api.GET('/v1/bookings/{bookingId}/partner-offers', {
          params: {
            path: { bookingId: source.bookingId },
            query: { currency: source.currency },
            header: await tripStore.bookingHeaders(source.bookingId),
          },
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
    },
  });

  const list = offers.data?.offers ?? [];
  if (list.length === 0) return null;

  const details = (offer: Offer): string =>
    [
      offer.fromPrice ? t('partners.from', { price: format.money(offer.fromPrice) }) : null,
      offer.rating
        ? t('partners.rating', {
            rating: format.number(offer.rating.average),
            count: format.number(offer.rating.count),
          })
        : null,
      offer.durationMinutes
        ? t('partners.hours', { hours: format.number(Math.round(offer.durationMinutes / 30) / 2) })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Card testID={testID} className="gap-4 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {heading}
      </Text>
      <Text className="font-body text-caption text-foreground">{t('partners.disclosure')}</Text>
      {list.map((offer) => (
        <View key={offer.id} className="gap-1">
          <Text className="font-body-bold text-caption text-muted">
            {t(`partners.category.${offer.category}`)}
            {offer.sample ? ` · ${t('partners.sample')}` : ''}
          </Text>
          <Text className="font-body-bold text-body text-foreground">
            {offer.title ?? t(`partners.categoryBody.${offer.category}`)}
          </Text>
          {details(offer) ? (
            <Text className="font-body text-body-sm text-foreground">{details(offer)}</Text>
          ) : null}
          <Button
            testID={`partner-offer-${offer.id}`}
            variant="secondary"
            onPress={() =>
              void openBrowserAsync(new URL(offer.href, appConfig.apiBaseUrl).toString())
            }
          >
            {t('partners.open', { partner: offer.partnerName })}
          </Button>
        </View>
      ))}
    </Card>
  );
}
