import { buttonVariants } from '@suskii/ui-web';
import { Check } from 'lucide-react';

import type { HomeContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';
import { Container } from '../layout/container';

/**
 * Suskii Prime block. Title and benefits come from the CMS; the price line appears only once the
 * owner sets Prime pricing (a business decision still open).
 */
export async function PrimePromo({ prime }: { prime: HomeContent['prime'] | undefined }) {
  const { t, format } = await getI18n();
  const benefits = prime?.benefits.length
    ? prime.benefits
    : [
        t('sections.prime.benefits.fares'),
        t('sections.prime.benefits.fees'),
        t('sections.prime.benefits.support'),
      ];
  const prices = [
    prime?.priceMonthly
      ? t('sections.prime.priceMonthly', { price: format.money(prime.priceMonthly) })
      : null,
    prime?.priceYearly
      ? t('sections.prime.priceYearly', { price: format.money(prime.priceYearly) })
      : null,
  ].filter((price): price is string => price !== null);
  return (
    <section aria-labelledby="prime-heading" className="py-10 md:py-16">
      <Container>
        <div className="flex flex-col gap-6 rounded-xl border border-l-4 border-border border-l-accent bg-surface p-6 md:flex-row md:items-center md:justify-between md:p-10">
          <div className="flex flex-col gap-3">
            <p className="font-body text-caption font-bold tracking-wide text-muted uppercase">
              {t('sections.prime.eyebrow')}
            </p>
            <h2 id="prime-heading" className="font-heading text-h2 font-extrabold text-heading">
              {prime?.title ?? t('sections.prime.heading')}
            </h2>
            <ul className="flex flex-col gap-2">
              {benefits.map((benefit) => (
                <li
                  key={benefit}
                  className="flex items-center gap-2 font-body text-body text-foreground"
                >
                  <Check aria-hidden="true" className="size-5 shrink-0 text-success" />
                  {benefit}
                </li>
              ))}
            </ul>
            {prices.length > 0 ? (
              <p className="font-heading text-h4 font-bold text-foreground">{prices.join(' · ')}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <AppLink
              href="/prime"
              className={buttonVariants({ variant: 'secondary', fullWidth: 'mobile' })}
            >
              {t('sections.prime.join')}
            </AppLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
