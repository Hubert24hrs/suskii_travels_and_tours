import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { sortTiers } from '@suskii/shared';
import { Badge } from '@suskii/ui-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { useT } from '../../providers/app-provider';

/** The in-house items of a quote or a booking (ADR-025): at most one is set. */
export type InhouseItems = Pick<Schemas['Quote'], 'package' | 'tour' | 'visa' | 'addon'>;
export type InhouseKind = 'package' | 'tour' | 'visa' | 'addon';

export function inhouseKind(items: InhouseItems): InhouseKind | null {
  if (items.package) return 'package';
  if (items.tour) return 'tour';
  if (items.visa) return 'visa';
  if (items.addon) return 'addon';
  return null;
}

function Line({ children }: { children: ReactNode }) {
  return <Text className="font-body text-body-sm text-foreground">{children}</Text>;
}

/** Refund tiers from the earliest cancellation to the latest, then "no refund after that". */
export function CancellationTiers({
  tiers,
}: {
  tiers: readonly { daysBefore: number; refundBps: number }[];
}) {
  const { t } = useT();
  const format = useFormatters();
  if (tiers.length === 0) return null;
  return (
    <View className="gap-1">
      <Text className="font-body-bold text-body-sm text-foreground">
        {t('booking.inhouse.cancellation')}
      </Text>
      {sortTiers(tiers)
        // A 0% tier says the same as the closing "no refund after that" line.
        .filter((tier) => tier.refundBps > 0)
        .map((tier) => {
          const percent = format.number(tier.refundBps / 100);
          return (
            <Line key={tier.daysBefore}>
              {tier.daysBefore === 0
                ? t('booking.inhouse.tierSameDay', { percent })
                : t('booking.inhouse.tier', { percent, count: tier.daysBefore })}
            </Line>
          );
        })}
      <Line>{t('booking.inhouse.tierNone')}</Line>
    </View>
  );
}

/**
 * What was bought, for packages, tours, visa assistance and add-ons: in the checkout summary
 * and on the trip screen. Sample (demo) inventory is labelled as such.
 */
export function InhouseSummary({
  items,
  showPolicy = true,
}: {
  items: InhouseItems;
  showPolicy?: boolean;
}) {
  const { t } = useT();
  const format = useFormatters();
  const kind = inhouseKind(items);
  const item = items.package ?? items.tour ?? items.visa ?? items.addon;
  if (!kind || !item) return null;
  const { package: pkg, tour, visa, addon } = items;
  const travellers = item.travellers.adults + item.travellers.children + item.travellers.infants;
  return (
    <View testID={`inhouse-${kind}`} className="gap-2">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="font-body-bold text-caption text-muted">
          {t(`booking.inhouse.${kind}`)}
        </Text>
        {item.product.sample ? (
          <Badge variant="neutral">{t('booking.inhouse.sample')}</Badge>
        ) : null}
      </View>
      <Text className="font-body-bold text-body text-foreground">{item.product.title}</Text>
      {pkg ? (
        <>
          <Line>
            {pkg.cityName}, {format.country(pkg.countryCode)}
          </Line>
          <Line>
            {format.dateRange(pkg.startDate, pkg.endDate, 'medium')} ·{' '}
            {t('booking.nights', { count: pkg.nights })}
          </Line>
        </>
      ) : null}
      {tour ? (
        <>
          <Line>
            {tour.cityName}, {format.country(tour.countryCode)}
          </Line>
          <Line>
            {t('booking.inhouse.startsAt', {
              time: `${format.date(tour.startsAtLocal.slice(0, 10), 'weekday')} ${tour.startsAtLocal.slice(11, 16)}`,
            })}
          </Line>
          <Line>
            {t('booking.inhouse.duration', {
              hours: Math.floor(tour.durationMinutes / 60),
              minutes: tour.durationMinutes % 60,
            })}
          </Line>
          <Line>
            {t('booking.inhouse.meetingPoint')}: {tour.meetingPoint.name},{' '}
            {tour.meetingPoint.address}
          </Line>
          {tour.meetingPoint.notes ? <Line>{tour.meetingPoint.notes}</Line> : null}
        </>
      ) : null}
      {visa ? (
        <>
          <Line>
            {t('booking.inhouse.destination', { country: format.country(visa.destination) })}
          </Line>
          <Line>
            {t('booking.inhouse.purpose', {
              purpose: t(`booking.inhouse.purposes.${visa.purpose}`),
            })}
          </Line>
          <Line>
            {t('booking.inhouse.travelDate', { date: format.date(visa.travelDate, 'long') })}
          </Line>
          <Line>
            {t('booking.inhouse.processing', {
              min: visa.processingDaysMin,
              max: visa.processingDaysMax,
            })}
          </Line>
        </>
      ) : null}
      {addon ? (
        <>
          <Line>{t(`booking.inhouse.types.${addon.type}`)}</Line>
          <Line>{format.dateRange(addon.startDate, addon.endDate, 'medium')}</Line>
          <Line>{t(`booking.inhouse.basis.${addon.pricingBasis}`, { count: addon.units })}</Line>
          {addon.linkedBooking ? (
            <Line>
              {t('booking.inhouse.linkedTo', { reference: addon.linkedBooking.reference })}
            </Line>
          ) : null}
        </>
      ) : null}
      <Line>{t('booking.inhouse.travellers', { count: travellers })}</Line>
      {visa ? (
        <Text className="font-body text-caption text-muted">{t('booking.inhouse.disclaimer')}</Text>
      ) : null}
      {showPolicy ? (
        <CancellationTiers tiers={(pkg ?? tour ?? addon)?.cancellationPolicy ?? []} />
      ) : null}
    </View>
  );
}
