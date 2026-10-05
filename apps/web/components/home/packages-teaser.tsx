import { Card } from '@suskii/ui-web';
import { Map, Palmtree } from 'lucide-react';

import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';

import { Section } from './section';

/** The lowest "from" price per adult among the products listed (all in one display currency). */
function lowest<T extends { fromPrice: { amountMinor: number; currency: string } }>(
  items: readonly T[],
): T['fromPrice'] | null {
  return items.reduce<T['fromPrice'] | null>(
    (best, item) =>
      !best || item.fromPrice.amountMinor < best.amountMinor ? item.fromPrice : best,
    null,
  );
}

/**
 * Packages and tours teaser with the lowest per-adult "from" price on sale (ADR-025). Without
 * inventory the cards introduce the two categories without prices (no invented fares).
 */
export async function PackagesTeaser() {
  const { t, format, currency } = await getI18n();
  const [packages, tours] = await Promise.all([
    api.packages({ currency, limit: '50' }),
    api.tours({ currency, limit: '50' }),
  ]);
  const packageFrom = lowest(packages?.packages ?? []);
  const tourFrom = lowest(tours?.tours ?? []);
  const cards = [
    {
      href: '/packages',
      icon: <Palmtree aria-hidden="true" className="size-10" />,
      title: t('sections.teaser.packagesTitle'),
      body: t('sections.teaser.packagesBody'),
      price: packageFrom
        ? t('inhouse.fromPerAdult', { price: format.moneyFrom(packageFrom) })
        : null,
    },
    {
      href: '/tours',
      icon: <Map aria-hidden="true" className="size-10" />,
      title: t('sections.teaser.toursTitle'),
      body: t('sections.teaser.toursBody'),
      price: tourFrom ? t('inhouse.fromPerAdult', { price: format.moneyFrom(tourFrom) }) : null,
    },
  ];
  return (
    <Section id="packages-tours" title={t('sections.teaser.heading')}>
      <ul className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <li key={card.href}>
            <Card interactive className="relative flex h-full items-start gap-4 p-6">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                {card.icon}
              </span>
              <div className="flex flex-col gap-2">
                <h3 className="font-heading text-h3 font-bold text-heading">
                  <AppLink
                    href={card.href}
                    className="after:absolute after:inset-0 focus-visible:focus-ring"
                  >
                    {card.title}
                  </AppLink>
                </h3>
                <p className="font-body text-body-sm text-foreground">{card.body}</p>
                {card.price ? (
                  <p className="font-body text-body font-bold text-heading">{card.price}</p>
                ) : null}
                <span aria-hidden="true" className="font-body text-body-sm font-bold text-primary">
                  {t('sections.teaser.explore')} →
                </span>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}
