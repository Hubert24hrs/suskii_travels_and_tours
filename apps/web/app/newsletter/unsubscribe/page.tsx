import type { Metadata } from 'next';

import { Container } from '../../../components/layout/container';
import { NewsletterTokenAction } from '../../../components/newsletter-token-action';
import { publicEnv } from '../../../lib/env';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('pages.newsletter.unsubscribeTitle'),
    description: t('pages.newsletter.unsubscribeBody'),
    path: '/newsletter/unsubscribe',
    noIndex: true,
  });
}

export default async function NewsletterUnsubscribePage() {
  const { t } = await getI18n();
  return (
    <Container className="py-12">
      <div className="flex max-w-dialog flex-col gap-4">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('pages.newsletter.unsubscribeTitle')}
        </h1>
        <p className="font-body text-body text-foreground">
          {t('pages.newsletter.unsubscribeBody')}
        </p>
        <NewsletterTokenAction
          action="unsubscribe"
          apiBaseUrl={publicEnv.apiBaseUrl}
          labels={{
            submit: t('pages.newsletter.unsubscribe'),
            done: t('pages.newsletter.unsubscribed'),
            invalidLink: t('pages.newsletter.invalidLink'),
            missingToken: t('pages.newsletter.missingToken'),
            error: t('sections.newsletter.error'),
            backHome: t('pages.newsletter.backHome'),
          }}
        />
      </div>
    </Container>
  );
}
