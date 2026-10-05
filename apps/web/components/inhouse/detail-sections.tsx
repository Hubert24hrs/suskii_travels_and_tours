import { sortTiers } from '@suskii/shared';
import type { ReactNode } from 'react';

import { getI18n } from '../../lib/i18n';

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-heading text-h3 font-bold text-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A titled bullet list (highlights, inclusions, exclusions); nothing when empty. */
export function TextList({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <Block id={id} title={title}>
      <ul className="flex list-disc flex-col gap-1 pl-5 font-body text-body text-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Block>
  );
}

export async function Itinerary({
  days,
}: {
  days: readonly { day: number; title: string; body: string }[];
}) {
  const { t } = await getI18n();
  if (days.length === 0) return null;
  return (
    <Block id="detail-itinerary" title={t('inhouse.detail.itinerary')}>
      <ol className="flex flex-col gap-4">
        {days.map((day) => (
          <li key={day.day} className="flex flex-col gap-1">
            <p className="font-body text-caption font-bold text-muted">
              {t('inhouse.detail.day', { day: day.day })}
            </p>
            <p className="font-body text-body font-bold text-foreground">{day.title}</p>
            <p className="font-body text-body text-foreground">{day.body}</p>
          </li>
        ))}
      </ol>
    </Block>
  );
}

/** Refund tiers from the earliest cancellation to the latest, as the booking will apply them. */
export async function PolicyTiers({
  tiers,
}: {
  tiers: readonly { daysBefore: number; refundBps: number }[];
}) {
  const { t, format } = await getI18n();
  if (tiers.length === 0) return null;
  return (
    <Block id="detail-cancellation" title={t('inhouse.detail.cancellation')}>
      <ul className="flex flex-col gap-1 font-body text-body text-foreground">
        {sortTiers(tiers)
          // A 0% tier says the same as the closing "no refund after that" line.
          .filter((tier) => tier.refundBps > 0)
          .map((tier) => {
            const percent = format.number(tier.refundBps / 100);
            return (
              <li key={tier.daysBefore}>
                {tier.daysBefore === 0
                  ? t('inhouse.detail.tierSameDay', { percent })
                  : t('inhouse.detail.tier', { percent, days: tier.daysBefore })}
              </li>
            );
          })}
        <li>{t('inhouse.detail.tierNone')}</li>
      </ul>
    </Block>
  );
}
