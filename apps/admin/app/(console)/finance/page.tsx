import type { Metadata } from 'next';

import { FinancePage } from '../../../components/pages/finance';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('finance.title') };

export default function Page() {
  return <FinancePage />;
}
