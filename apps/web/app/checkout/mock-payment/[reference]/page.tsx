import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { MockPayment } from '../../../../components/checkout/mock-payment';
import { pickBookingMessages } from '../../../../components/checkout/pick-booking-messages';
import { Container } from '../../../../components/layout/container';
import { getI18n } from '../../../../lib/i18n';
import { pageMetadata } from '../../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('payment.title'),
    description: t('payment.notice'),
    path: '/checkout',
    noIndex: true,
  });
}

/** Hosted page of the mock payment provider (development and tests only; the API refuses the mock in production). */
export default async function MockPaymentPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { t, locale, messages } = await getI18n();
  const { reference } = await params;
  return (
    <Container className="pt-8 pb-16">
      <div className="mx-auto flex w-full max-w-dialog flex-col gap-6">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('payment.heading')}</h1>
        <I18nProvider locale={locale} messages={pickBookingMessages(messages)}>
          <MockPayment reference={reference} />
        </I18nProvider>
      </div>
    </Container>
  );
}
