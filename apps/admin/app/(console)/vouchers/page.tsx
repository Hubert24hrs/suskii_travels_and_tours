import type { Metadata } from 'next';

import { VouchersPage } from '../../../components/pages/vouchers';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('vouchers.title') };

export default function Page() {
  return <VouchersPage />;
}
