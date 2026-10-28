import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MetasearchPage } from '../../../components/pages/metasearch';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('metasearch.title') };

export default function Page() {
  return (
    <Suspense>
      <MetasearchPage />
    </Suspense>
  );
}
