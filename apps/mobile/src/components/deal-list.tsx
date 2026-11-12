import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { flightFormToParams, DEFAULT_TRAVELLERS } from '@suskii/shared';
import { DealCard } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { useApp, useT } from '../providers/app-provider';

type Deal = Schemas['FlightDeal'];

/** The search a deal card opens: the same route and dates, one adult. */
export function dealSearchPath(deal: Deal): string {
  const params = flightFormToParams(
    deal.returnDate
      ? {
          tripType: 'round_trip',
          origin: deal.origin.code,
          destination: deal.destination.code,
          departureDate: deal.departureDate,
          returnDate: deal.returnDate,
          travellers: DEFAULT_TRAVELLERS,
          cabinClass: deal.cabinClass,
          directOnly: false,
          flexibleDates: false,
        }
      : {
          tripType: 'one_way',
          origin: deal.origin.code,
          destination: deal.destination.code,
          departureDate: deal.departureDate,
          travellers: DEFAULT_TRAVELLERS,
          cabinClass: deal.cabinClass,
          directOnly: false,
          flexibleDates: false,
        },
  );
  return `/search/flights?${params.toString()}`;
}

export function useDeals(limit: number) {
  const { api, currency } = useApp();
  return useQuery({
    queryKey: ['deals', currency, limit],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.GET('/v1/deals/flights', {
        params: { query: { currency, limit } },
      });
      return data?.deals ?? [];
    },
  });
}

/** Deal cards (freshness shown on each, pricing guardrails); tapping one searches it. */
export function DealList({ deals }: { deals: readonly Deal[] }) {
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  return (
    <View className="gap-3">
      {deals.map((deal) => (
        <DealCard
          key={deal.id}
          media={
            <View className="flex-1 items-center justify-center bg-primary-subtle">
              <Text className="font-heading text-h2 text-primary">{deal.destination.code}</Text>
            </View>
          }
          originCode={deal.origin.code}
          destinationCode={deal.destination.code}
          routeLabel={t('sections.deals.route', {
            origin: deal.origin.cityName,
            destination: deal.destination.cityName,
          })}
          airlineName={deal.carrier.name}
          dates={
            deal.returnDate
              ? format.dateRange(deal.departureDate, deal.returnDate, 'short')
              : format.date(deal.departureDate, 'short')
          }
          cabin={t(`cabins.${deal.cabinClass}`)}
          priceLabel={t('common.fromPrice', { price: format.moneyFrom(deal.price) })}
          discountLabel={deal.sample ? t('common.sampleFare') : undefined}
          updatedLabel={t('common.updated', { time: format.relativeTime(deal.updatedAt) })}
          ctaLabel={t('sections.deals.cta')}
          onPress={() => router.push(dealSearchPath(deal))}
        />
      ))}
    </View>
  );
}
