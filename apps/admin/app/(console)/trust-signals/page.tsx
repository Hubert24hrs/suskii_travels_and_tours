import type { Metadata } from 'next';

import { TrustSignalsPage } from '../../../components/pages/trust-signals';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('trust.title') };

export default function Page() {
  return <TrustSignalsPage />;
}
