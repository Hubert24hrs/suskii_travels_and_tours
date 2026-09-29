import { Card } from '@suskii/ui-web';
import { Map, Palmtree } from 'lucide-react';

import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';

import { Section } from './section';

/**
 * Packages and tours teaser. Per-person "from" prices arrive with the curated inventory in phase 8;
 * until then the cards introduce the two categories without prices (no invented fares).
 */
export async function PackagesTeaser() {
  const { t } = await getI18n();
  const cards = [
    {
      href: '/packages',
      icon: <Palmtree aria-hidden="true" className="size-10" />,
      title: t('sections.teaser.packagesTitle'),
      body: t('sections.teaser.packagesBody'),
    },
    {
      href: '/tours',
      icon: <Map aria-hidden="true" className="size-10" />,
      title: t('sections.teaser.toursTitle'),
      body: t('sections.teaser.toursBody'),
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
