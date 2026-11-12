import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RefundsPage } from '../../../components/pages/refunds';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('refunds.title') };

export default function Page() {
  return (
    <Suspense>
      <RefundsPage />
    </Suspense>
  );
}
