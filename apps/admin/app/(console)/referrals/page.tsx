import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReferralsPage } from '../../../components/pages/referrals';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('referrals.title') };

export default function Page() {
  return (
    <Suspense>
      <ReferralsPage />
    </Suspense>
  );
}
