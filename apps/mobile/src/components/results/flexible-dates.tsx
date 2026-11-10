import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import type { CurrencyCode, FlightSearchRequest } from '@suskii/shared';
import { Badge } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useApp, useT } from '../../providers/app-provider';

type Day = Schemas['FlightDatePrices']['days'][number];

/**
 * "Flexible dates": the lowest total on each day around the search (`flexible-day-{offset}`);
 * pressing one searches that day. A return trip keeps its length, so both dates move. Shown
 * only when the traveller asked for flexible dates: every day that is not cached is a supplier
 * search (ADR-093).
 */
export function FlexibleDates({
  request,
  currency,
  onChoose,
}: {
  request: FlightSearchRequest;
  currency: CurrencyCode;
  onChoose: (day: { departureDate: string; returnDate: string | null }) => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const prices = useQuery({
    queryKey: ['flight-date-prices', request, currency],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.POST('/v1/flights/date-prices', {
        params: { query: { currency } },
        body: request,
      });
      if (!data) throw new Error('date-prices');
      return data;
    },
  });

  if (prices.isPending) {
    return (
      <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-foreground">
        {t('results.flexible.loading')}
      </Text>
    );
  }
  if (!prices.data) {
    return (
      <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-foreground">
        {t('results.flexible.failed')}
      </Text>
    );
  }
  if (prices.data.days.length === 0) return null;

  const price = (day: Day): string =>
    day.total
      ? format.money(day.total)
      : t(day.status === 'none' ? 'results.flexible.none' : 'results.flexible.check');

  return (
    <View testID="flexible-dates" className="gap-2">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('results.flexible.heading')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {prices.data.days.map((day) => {
            const date = format.date(day.departureDate, 'weekday');
            const current = day.offset === 0;
            return (
              <Pressable
                key={day.offset}
                testID={`flexible-day-${day.offset}`}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                accessibilityLabel={t('results.flexible.dayLabel', { date, price: price(day) })}
                onPress={() =>
                  onChoose({ departureDate: day.departureDate, returnDate: day.returnDate })
                }
                className={
                  current
                    ? 'min-h-12 items-start gap-1 rounded-md border border-primary bg-primary-subtle px-3 py-2'
                    : 'min-h-12 items-start gap-1 rounded-md border border-border-strong bg-surface px-3 py-2'
                }
              >
                <Text className="font-body-bold text-body-sm text-foreground">{date}</Text>
                <Text className="font-body text-body-sm text-foreground">{price(day)}</Text>
                {day.offset === prices.data.cheapestOffset ? (
                  <Badge variant="success">{t('results.flexible.lowest')}</Badge>
                ) : current ? (
                  <Text className="font-body text-caption text-foreground">
                    {t('results.flexible.yourDate')}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Text className="font-body text-caption text-foreground">
        {t('results.flexible.note')}
        {request.slices.length > 1 ? ` ${t('results.flexible.returnNote')}` : ''}
      </Text>
    </View>
  );
}
