import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

type Offer = Schemas['FlightOffer'];
type Slice = Offer['slices'][number];

export const clock = (local: string): string => local.slice(11, 16);

export function useDuration(): (minutes: number) => string {
  const { t } = useT();
  return (minutes) =>
    t('results.flights.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function SliceRow({ slice, label }: { slice: Slice; label: string }) {
  const { t } = useT();
  const duration = useDuration();
  return (
    <View className="gap-1">
      <Text className="font-body text-caption text-muted">{label}</Text>
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="font-heading text-h4 text-heading">{clock(slice.departureLocal)}</Text>
          <Text className="font-body text-body-sm text-foreground">{slice.origin.code}</Text>
        </View>
        <View className="flex-1 items-center px-3">
          <Text className="font-body text-caption text-muted">
            {duration(slice.durationMinutes)}
          </Text>
          <View className="my-1 h-px w-full bg-border" />
          <Text className="font-body text-caption text-foreground">
            {slice.stops === 0
              ? t('results.flights.direct')
              : t('results.flights.stops', { count: slice.stops })}
          </Text>
        </View>
        <View className="items-end">
          <Text className="font-heading text-h4 text-heading">
            {clock(slice.arrivalLocal)}
            {slice.arrivalDayOffset > 0 ? ` +${slice.arrivalDayOffset}` : ''}
          </Text>
          <Text className="font-body text-body-sm text-foreground">{slice.destination.code}</Text>
        </View>
      </View>
    </View>
  );
}

function Details({ offer }: { offer: Offer }) {
  const { t } = useT();
  const format = useFormatters();
  const duration = useDuration();
  const { conditions } = offer;
  return (
    <View className="gap-3 border-t border-border pt-3">
      {offer.slices.map((slice, index) => (
        <View key={index} className="gap-2">
          {slice.fareBrand ? (
            <Text className="font-body-bold text-body-sm text-heading">
              {t('results.flights.fareBrand', { brand: slice.fareBrand })}
            </Text>
          ) : null}
          {slice.segments.map((segment, position) => (
            <Text key={position} className="font-body text-body-sm text-foreground">
              {clock(segment.departureLocal)} {segment.origin.code} → {clock(segment.arrivalLocal)}{' '}
              {segment.destination.code} ·{' '}
              {t('results.flights.flight', {
                carrier: segment.marketingCarrier.name,
                number: segment.flightNumber,
              })}
            </Text>
          ))}
          {slice.layovers.map((layover, position) => (
            <Text key={position} className="font-body text-caption text-warning-text">
              {t('results.flights.layover', {
                duration: duration(layover.durationMinutes),
                airport: layover.airport.cityName ?? layover.airport.code,
              })}
              {layover.warnings.length > 0
                ? ` · ${layover.warnings
                    .map((warning) => t(`results.flights.layoverWarnings.${warning}`))
                    .join(', ')}`
                : ''}
            </Text>
          ))}
        </View>
      ))}
      <Text className="font-body text-body-sm text-foreground">
        {t('results.flights.carryOn')} ·{' '}
        {t('results.flights.checked', { count: offer.baggage.checked })}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {conditions.refundable
          ? conditions.refundPenalty
            ? t('results.flights.refundFee', { amount: format.money(conditions.refundPenalty) })
            : t('results.flights.refundable')
          : t('results.flights.nonRefundable')}{' '}
        ·{' '}
        {conditions.changeable
          ? conditions.changePenalty
            ? t('results.flights.changeFee', { amount: format.money(conditions.changePenalty) })
            : t('results.flights.changeable')
          : t('results.flights.notChangeable')}
      </Text>
    </View>
  );
}

export interface FlightOfferCardProps {
  offer: Offer;
  travellers: number;
  busy: boolean;
  notice?: string | undefined;
  noticeAction?: { label: string; onPress: () => void } | undefined;
  onSelect: () => void;
}

/** One fare in the results: times, stops, duration, price, and fare details on demand. */
export function FlightOfferCard({
  offer,
  travellers,
  busy,
  notice,
  noticeAction,
  onSelect,
}: FlightOfferCardProps) {
  const { t } = useT();
  const format = useFormatters();
  const [open, setOpen] = useState(false);
  const labels = offer.slices.map((_, index) =>
    offer.slices.length === 1
      ? t('results.flights.slice.outbound')
      : offer.slices.length === 2
        ? index === 0
          ? t('results.flights.slice.outbound')
          : t('results.flights.slice.return')
        : t('results.flights.slice.leg', { number: index + 1 }),
  );
  return (
    <View testID="flight-offer" className="px-4 py-2">
      <Card className="gap-3 p-4">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 font-body-bold text-body text-heading" numberOfLines={1}>
            {offer.owner.name}
          </Text>
          {offer.supplier === 'mock' ? (
            <Badge variant="neutral">{t('results.demoBadge')}</Badge>
          ) : null}
          {offer.conditions.refundable ? (
            <Badge variant="success">{t('results.flights.refundable')}</Badge>
          ) : null}
        </View>
        {offer.slices.map((slice, index) => (
          <SliceRow key={index} slice={slice} label={labels[index] ?? ''} />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          className="min-h-12 justify-center"
        >
          <Text className="font-body-bold text-body-sm text-primary">
            {open ? t('results.flights.hideDetails') : t('results.flights.details')}
          </Text>
        </Pressable>
        {open ? <Details offer={offer} /> : null}
        {notice ? (
          <View accessibilityRole="alert" className="gap-2 rounded-md bg-primary-subtle p-3">
            <Text className="font-body text-body-sm text-foreground">{notice}</Text>
            {noticeAction ? (
              <Button variant="ghost" onPress={noticeAction.onPress}>
                {noticeAction.label}
              </Button>
            ) : null}
          </View>
        ) : null}
        <View className="flex-row items-end justify-between gap-3">
          <View>
            <Text className="font-heading text-h3 text-heading">
              {format.money(offer.price.total)}
            </Text>
            <Text className="font-body text-caption text-muted">
              {t('results.flights.total', { count: travellers })}
            </Text>
          </View>
          <Button
            testID="select-offer"
            loading={busy}
            accessibilityLabel={t('results.flights.selectLabel', {
              carrier: offer.owner.name,
              price: format.money(offer.price.total),
            })}
            onPress={onSelect}
          >
            {t('results.flights.select')}
          </Button>
        </View>
      </Card>
    </View>
  );
}
