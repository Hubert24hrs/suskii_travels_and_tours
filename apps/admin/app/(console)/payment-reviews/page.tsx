import type { Metadata } from 'next';

import { PaymentReviewsPage } from '../../../components/pages/payment-reviews';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('paymentReviews.title') };

export default function Page() {
  return <PaymentReviewsPage />;
}
