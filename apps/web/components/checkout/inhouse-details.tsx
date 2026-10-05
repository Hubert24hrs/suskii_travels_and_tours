'use client';

import { useFormatters } from '@suskii/i18n/react';
import { sortTiers } from '@suskii/shared/lite';
import { Badge } from '@suskii/ui-web';
import type { ReactNode } from 'react';

import type { Schemas } from '../../lib/browser-api';

import { useBookingT } from './checkout-messages';

/** The in-house items of a quote or a booking (ADR-025): at most one is set. */
export type InhouseItems = Pick<Schemas['Quote'], 'package' | 'tour' | 'visa' | 'addon'>;
export type InhouseKind = 'package' | 'tour' | 'visa' | 'addon';
type Counts = Schemas['TravellerCounts'];
type Tier = Schemas['CancellationTier'];

export function inhouseKind(items: InhouseItems): InhouseKind | null {
  if (items.package) return 'package';
  if (items.tour) return 'tour';
  if (items.visa) return 'visa';
  if (items.addon) return 'addon';
  return null;
}

const travellerCount = (counts: Counts): number => counts.adults + counts.children + counts.infants;

/** The product reference shared by every in-house item. */
function productOf(items: InhouseItems) {
  return (items.package ?? items.tour ?? items.visa ?? items.addon)?.product ?? null;
}

/** Refund tiers from the earliest cancellation to the latest, then "no refund after that". */
export function CancellationTiers({ tiers }: { tiers: readonly Tier[] }) {
  const { t } = useBookingT();
  const format = useFormatters();
  if (tiers.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-body text-body-sm font-bold text-foreground">
        {t('booking.inhouse.cancellation')}
      </h3>
      <ul className="flex flex-col gap-1 font-body text-body-sm text-foreground">
        {sortTiers(tiers)
          // A 0% tier says the same as the closing "no refund after that" line.
          .filter((tier) => tier.refundBps > 0)
          .map((tier) => {
            const percent = format.number(tier.refundBps / 100);
            return (
              <li key={tier.daysBefore}>
                {tier.daysBefore === 0
                  ? t('booking.inhouse.tierSameDay', { percent })
                  : t('booking.inhouse.tier', { percent, count: tier.daysBefore })}
              </li>
            );
          })}
        <li>{t('booking.inhouse.tierNone')}</li>
      </ul>
    </div>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <p className="font-body text-body-sm text-foreground">{children}</p>;
}

/**
 * What was bought, for packages, tours, visa assistance and add-ons: shown in the checkout
 * summary and on the booking page. Sample (demo) inventory is labelled as such.
 */
export function InhouseDetails({
  items,
  showPolicy = true,
}: {
  items: InhouseItems;
  showPolicy?: boolean;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const kind = inhouseKind(items);
  const product = productOf(items);
  if (!kind || !product) return null;
  const { package: pkg, tour, visa, addon } = items;
  const travellers = travellerCount((pkg ?? tour ?? visa ?? addon)?.travellers ?? NO_ONE);

  return (
    <div className="flex flex-col gap-3" data-testid={`inhouse-${kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-body text-caption font-bold text-muted">
          {t(`booking.inhouse.${kind}`)}
        </p>
        {product.sample ? <Badge variant="neutral">{t('booking.inhouse.sample')}</Badge> : null}
      </div>
      <p className="font-body text-body font-bold text-foreground">{product.title}</p>
      {product.sample ? (
        <p className="font-body text-caption text-foreground">{t('booking.inhouse.sampleNote')}</p>
      ) : null}

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
            {t('booking.inhouse.startsAt', { time: format.dateTime(tour.startsAt, tour.timeZone) })}
          </Line>
          <Line>
            {t('booking.inhouse.duration', {
              hours: Math.floor(tour.durationMinutes / 60),
              minutes: tour.durationMinutes % 60,
            })}
          </Line>
          <div className="flex flex-col gap-1">
            <h3 className="font-body text-body-sm font-bold text-foreground">
              {t('booking.inhouse.meetingPoint')}
            </h3>
            <Line>
              {tour.meetingPoint.name}, {tour.meetingPoint.address}
            </Line>
            {tour.meetingPoint.notes ? <Line>{tour.meetingPoint.notes}</Line> : null}
          </div>
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
            {t('booking.inhouse.nationality', { country: format.country(visa.nationality) })}
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
          {visa.governmentFeeNote ? (
            <Line>{t('booking.inhouse.governmentFee', { note: visa.governmentFeeNote })}</Line>
          ) : null}
        </>
      ) : null}

      {addon ? (
        <>
          <Line>{t(`booking.inhouse.types.${addon.type}`)}</Line>
          <Line>
            {format.dateRange(addon.startDate, addon.endDate, 'medium')}
            {addon.cityName ? ` · ${addon.cityName}` : ''}
            {!addon.cityName && addon.countryCode ? ` · ${format.country(addon.countryCode)}` : ''}
          </Line>
          <Line>{t(`booking.inhouse.basis.${addon.pricingBasis}`, { count: addon.units })}</Line>
          {addon.linkedBooking ? (
            <Line>
              {t('booking.inhouse.linkedTo', { reference: addon.linkedBooking.reference })}
            </Line>
          ) : null}
        </>
      ) : null}

      <Line>{t('booking.inhouse.travellers', { count: travellers })}</Line>

      {pkg && pkg.inclusions.length > 0 ? (
        <Included items={pkg.inclusions} />
      ) : tour && tour.inclusions.length > 0 ? (
        <Included items={tour.inclusions} />
      ) : null}

      {visa ? (
        <p className="font-body text-caption text-foreground">{t('booking.inhouse.disclaimer')}</p>
      ) : null}

      {showPolicy ? (
        <CancellationTiers tiers={(pkg ?? tour ?? addon)?.cancellationPolicy ?? []} />
      ) : null}
    </div>
  );
}

const NO_ONE: Counts = { adults: 0, children: 0, infants: 0 };

function Included({ items }: { items: readonly string[] }) {
  const { t } = useBookingT();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-body text-body-sm font-bold text-foreground">
        {t('booking.inhouse.included')}
      </h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 font-body text-body-sm text-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
