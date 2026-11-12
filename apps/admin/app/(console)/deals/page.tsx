import type { Metadata } from 'next';

import { DealsPage } from '../../../components/pages/deals';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('deals.title') };

export default function Page() {
  return <DealsPage />;
}
