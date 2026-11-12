import type { Metadata } from 'next';
import { Suspense } from 'react';

import { VisaPage } from '../../../components/pages/visa';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('visa.title') };

export default function Page() {
  return (
    <Suspense>
      <VisaPage />
    </Suspense>
  );
}
