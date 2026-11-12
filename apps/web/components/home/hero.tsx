import { TrustBar } from '@suskii/ui-web';

import type { HomeContent, SiteContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { HeroArt } from '../art/hero-art';
import { Container } from '../layout/container';

import { trustIcon } from './trust-icons';

/**
 * Hero on the light sky background: headline and subheadline from the CMS (spec copy as the
 * fallback) and the trust bar, which only ever receives verified signals from the API.
 */
export async function Hero({
  hero,
  trustSignals,
  title,
  subtitle,
}: {
  hero?: HomeContent['hero'] | undefined;
  trustSignals: SiteContent['trustSignals'];
  /** Vertical landing pages pass their own heading. */
  title?: string;
  subtitle?: string;
}) {
  const { t } = await getI18n();
  const headline = title ?? hero?.headline ?? t('hero.headline');
  const subheadline = subtitle ?? hero?.subheadline ?? t('hero.subheadline');
  return (
    <section aria-labelledby="hero-heading" className="bg-background pt-6 pb-20 md:pt-10">
      <Container className="grid items-center gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h1
            id="hero-heading"
            className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero"
          >
            {headline}
          </h1>
          <p className="max-w-dialog font-body text-body text-foreground md:text-h4">
            {subheadline}
          </p>
          <TrustBar
            label={t('hero.trustLabel')}
            items={trustSignals.map((signal) => ({
              id: signal.key,
              label: signal.value ? `${signal.value} ${signal.label}` : signal.label,
              icon: trustIcon(signal.key),
            }))}
            className="mt-2"
          />
        </div>
        <div className="hidden justify-end lg:flex">
          <HeroArt className="max-w-dialog" />
        </div>
      </Container>
    </section>
  );
}
