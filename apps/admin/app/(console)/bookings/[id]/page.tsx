import type { Metadata } from 'next';

import { BookingDetailPage } from '../../../../components/pages/bookings';
import { t } from '../../../../lib/i18n';

export const metadata: Metadata = { title: t('bookings.title') };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingDetailPage bookingId={id} />;
}
