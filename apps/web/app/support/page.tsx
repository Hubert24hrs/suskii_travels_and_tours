import { I18nProvider } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-web';
import type { Metadata } from 'next';

import { Breadcrumbs } from '../../components/breadcrumbs';
import { Container } from '../../components/layout/container';
import { pickSupportMessages } from '../../components/support/support-messages';
import { SupportList } from '../../components/support/support-list';
import { SupportStart } from '../../components/support/support-start';
import { api } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('support.heading'),
    description: t('support.intro'),
    path: '/support',
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Help and support (ADR-083): published FAQs, a form that starts a conversation (about a booking
 * when the booking page links here) and, for signed-in travellers, their conversations.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, locale, messages } = await getI18n();
  const booking = (await searchParams).booking;
  const bookingId = typeof booking === 'string' && UUID.test(booking) ? booking : null;
  const faqs = (await api.home(locale))?.faqs ?? [];
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <Breadcrumbs items={[{ name: t('support.heading'), path: '/support' }]} />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('support.heading')}</h1>
        <p className="font-body text-body text-foreground">{t('support.intro')}</p>
      </div>
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:items-start">
        <I18nProvider locale={locale} messages={pickSupportMessages(messages)}>
          <div className="flex flex-col gap-6">
            <SupportStart turnstileSiteKey={publicEnv.turnstileSiteKey} bookingId={bookingId} />
            <SupportList />
          </div>
        </I18nProvider>
        {faqs.length > 0 ? (
          <section aria-labelledby="support-faqs" className="flex flex-col gap-3">
            <h2 id="support-faqs" className="font-heading text-h3 font-bold text-heading">
              {t('support.faqHeading')}
            </h2>
            {faqs.map((faq) => (
              <Card key={faq.id} className="p-4">
                <details>
                  <summary className="cursor-pointer font-body text-body font-bold text-foreground">
                    {faq.question}
                  </summary>
                  <p className="mt-2 font-body text-body text-foreground">{faq.answer}</p>
                </details>
              </Card>
            ))}
          </section>
        ) : null}
      </div>
    </Container>
  );
}
