import { BRAND } from '@suskii/shared';

import type { SiteContent } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
import { Container } from '../layout/container';

import { NewsletterForm } from './newsletter-form';

export async function NewsletterSection({ site }: { site: SiteContent | null }) {
  const { t, locale } = await getI18n();
  const privacy = site?.pages.find((page) => page.slug === 'privacy');
  return (
    <section id="newsletter" aria-labelledby="newsletter-heading" className="py-10 md:py-16">
      <Container>
        <div className="grid gap-6 rounded-xl border border-border bg-surface p-6 md:grid-cols-2 md:p-10">
          <div className="flex flex-col gap-2">
            <h2
              id="newsletter-heading"
              className="font-heading text-h2 font-extrabold text-heading"
            >
              {t('sections.newsletter.heading')}
            </h2>
            <p className="font-body text-body text-foreground">{t('sections.newsletter.body')}</p>
          </div>
          <NewsletterForm
            apiBaseUrl={publicEnv.apiBaseUrl}
            turnstileSiteKey={publicEnv.turnstileSiteKey}
            locale={locale}
            privacyHref={privacy ? `/info/${privacy.slug}` : null}
            labels={{
              email: t('sections.newsletter.email'),
              emailPlaceholder: t('sections.newsletter.emailPlaceholder'),
              whatsappOptIn: t('sections.newsletter.whatsappOptIn'),
              phone: t('sections.newsletter.phone'),
              phoneHint: t('sections.newsletter.phoneHint'),
              consent: t('sections.newsletter.consent', { brand: BRAND.shortName }),
              privacy: t('sections.newsletter.privacy'),
              submit: t('sections.newsletter.submit'),
              success: t('sections.newsletter.success'),
              error: t('sections.newsletter.error'),
              rateLimited: t('sections.newsletter.rateLimited'),
              invalidEmail: t('sections.newsletter.invalidEmail'),
              invalidPhone: t('sections.newsletter.invalidPhone'),
              consentRequired: t('sections.newsletter.consentRequired'),
              verifying: t('sections.newsletter.verifying'),
            }}
          />
        </div>
      </Container>
    </section>
  );
}
