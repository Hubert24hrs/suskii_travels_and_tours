import type { Metadata } from 'next';
import { Suspense } from 'react';

import { BookingsPage } from '../../../components/pages/bookings';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('bookings.title') };

export default function Page() {
  return (
    <Suspense>
      <BookingsPage />
    </Suspense>
  );
}
