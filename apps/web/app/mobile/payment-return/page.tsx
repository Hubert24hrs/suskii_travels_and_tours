import { Card } from '@suskii/ui-web';
import type { Metadata } from 'next';

import { Container } from '../../../components/layout/container';
import { OpenApp } from '../../../components/mobile/open-app';
import { getI18n } from '../../../lib/i18n';
import { appBuiltTripUrl, appTripUrl } from '../../../lib/mobile-app';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('mobileReturn.title'),
    description: t('mobileReturn.body'),
    path: '/mobile/payment-return',
    noIndex: true,
  });
}

/**
 * Where hosted checkouts started in the app send the traveller back (providers only accept https
 * return URLs). It carries no booking data: the app polls the booking itself (ADR-021).
 */
export default async function MobilePaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string | string[]; trip?: string | string[] }>;
}) {
  const { t } = await getI18n();
  const { booking, trip } = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  // A combined trip's payment comes back to the trip (ADR-099), a booking's to the booking.
  const href = one(trip) ? appBuiltTripUrl(one(trip)) : appTripUrl(one(booking));
  return (
    <Container className="pt-8 pb-16">
      <Card className="mx-auto flex w-full max-w-dialog flex-col gap-4 p-6">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('mobileReturn.heading')}
        </h1>
        <p className="font-body text-body text-foreground">{t('mobileReturn.body')}</p>
        <OpenApp href={href} label={t('mobileReturn.open')} />
      </Card>
    </Container>
  );
}
