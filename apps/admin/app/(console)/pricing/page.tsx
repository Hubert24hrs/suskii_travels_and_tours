import type { Metadata } from 'next';

import { PricingPage } from '../../../components/pages/pricing';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('pricing.title') };

export default function Page() {
  return <PricingPage />;
}
