import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Rate = Schemas['HotelRate'];

class ExpiredError extends Error {}

/** Every rate of one hotel: room, meals, cancellation terms, charges paid at the hotel. */
export function HotelRatesScreen() {
  const { hotelId } = useLocalSearchParams<{ hotelId: string }>();
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [selecting, setSelecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ rateId: string; text: string; quoteId?: string } | null>(
    null,
  );

  const hotel = useQuery({
    queryKey: ['hotel', hotelId, currency],
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/hotels/results/{hotelId}', {
        params: { path: { hotelId }, query: { currency } },
      });
      if (response.status === 410) throw new ExpiredError();
      if (!data) throw new Error('hotel');
      return data;
    },
  });

  const select = async (rate: Rate) => {
    setSelecting(rate.id);
    setNotice(null);
    try {
      const { data, response } = await api.POST('/v1/hotels/rates/{rateId}/quote', {
        params: { path: { rateId: rate.id }, query: { currency } },
      });
      if (data?.priceChange) {
        setNotice({
          rateId: rate.id,
          quoteId: data.quoteId,
          text: t('results.priceChanged', {
            previous: format.money(data.priceChange.previous),
            current: format.money(data.priceChange.current),
          }),
        });
      } else if (data) {
        router.push(`/checkout/${data.quoteId}` as Href);
      } else {
        setNotice({
          rateId: rate.id,
          text: response.status === 410 ? t('results.offerGone') : t('results.error'),
        });
      }
    } catch {
      setNotice({ rateId: rate.id, text: t('mobile.networkError') });
    } finally {
      setSelecting(null);
    }
  };

  if (hotel.isPending) return <Loading label={t('mobile.loading')} />;
  if (hotel.error instanceof ExpiredError)
    return (
      <Notice
        body={t('results.expired')}
        action={t('results.hotels.backToResults')}
        onAction={() => router.back()}
      />
    );
  if (!hotel.data)
    return (
      <Notice
        body={t('results.error')}
        action={t('results.retry')}
        onAction={() => void hotel.refetch()}
      />
    );

  const detail = hotel.data;
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4">
      <Stack.Screen options={{ title: detail.name }} />
      <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
        {detail.name}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('results.hotels.stars', { count: detail.stars })} ·{' '}
        {[detail.area, detail.cityName].filter(Boolean).join(', ')}
      </Text>
      <Text accessibilityRole="header" className="pt-2 font-heading text-h4 text-heading">
        {t('results.hotels.rooms')}
      </Text>
      {detail.rates.map((rate) => (
        <Card key={rate.id} className="gap-2 p-4">
          <Text className="font-body-bold text-body text-heading">{rate.roomName}</Text>
          <Text className="font-body text-body-sm text-foreground">
            {t(`results.boards.${rate.board}`)}
          </Text>
          {rate.refundable ? (
            <Badge variant="success">
              {rate.freeCancellationUntil
                ? t('results.hotels.freeCancellationUntil', {
                    date: format.date(rate.freeCancellationUntil.slice(0, 10), 'medium'),
                  })
                : t('results.hotels.freeCancellation')}
            </Badge>
          ) : (
            <Badge variant="neutral">{t('results.hotels.nonRefundable')}</Badge>
          )}
          {rate.payAtProperty ? (
            <Text className="font-body text-caption text-foreground">
              {t('results.hotels.payAtProperty', { amount: format.money(rate.payAtProperty) })}
            </Text>
          ) : null}
          {notice?.rateId === rate.id ? (
            <View accessibilityRole="alert" className="gap-2 rounded-md bg-primary-subtle p-3">
              <Text className="font-body text-body-sm text-foreground">{notice.text}</Text>
              {notice.quoteId ? (
                <Button
                  variant="ghost"
                  onPress={() => router.push(`/checkout/${notice.quoteId ?? ''}` as Href)}
                >
                  {t('results.continueAtPrice', { price: format.money(rate.price.total) })}
                </Button>
              ) : null}
            </View>
          ) : null}
          <View className="flex-row items-end justify-between">
            <View>
              <Text className="font-heading text-h3 text-heading">
                {format.money(rate.price.total)}
              </Text>
              <Text className="font-body text-caption text-muted">
                {t('results.hotels.perNight', { price: format.money(rate.pricePerNight) })}
              </Text>
            </View>
            <Button
              loading={selecting === rate.id}
              accessibilityLabel={t('results.hotels.selectLabel', {
                room: rate.roomName,
                board: t(`results.boards.${rate.board}`),
                price: format.money(rate.price.total),
              })}
              onPress={() => void select(rate)}
            >
              {t('results.hotels.select')}
            </Button>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
