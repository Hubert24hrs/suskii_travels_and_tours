import type { Metadata } from 'next';

import { DriversPage } from '../../../components/pages/drivers';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('drivers.title') };

export default function Page() {
  return <DriversPage />;
}
