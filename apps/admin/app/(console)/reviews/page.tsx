import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReviewsPage } from '../../../components/pages/reviews';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('reviews.title') };

export default function Page() {
  return (
    <Suspense>
      <ReviewsPage />
    </Suspense>
  );
}
