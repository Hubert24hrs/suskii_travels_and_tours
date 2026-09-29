import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { BookingView } from '../../../components/checkout/booking-view';
import { pickBookingMessages } from '../../../components/checkout/pick-booking-messages';
import { Container } from '../../../components/layout/container';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('booking.title'),
    description: t('booking.title'),
    path: '/bookings',
    noIndex: true,
  });
}

/** A booking, opened by its owner or with the guest token saved in this tab. Never indexed. */
export default async function BookingPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { locale, messages } = await getI18n();
  const { bookingId } = await params;
  return (
    <Container className="pt-8 pb-16">
      <I18nProvider locale={locale} messages={pickBookingMessages(messages)}>
        <BookingView bookingId={bookingId} />
      </I18nProvider>
    </Container>
  );
}
