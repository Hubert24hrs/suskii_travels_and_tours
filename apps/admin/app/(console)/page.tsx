import type { Metadata } from 'next';

import { DashboardPage } from '../../components/pages/dashboard';
import { t } from '../../lib/i18n';

export const metadata: Metadata = { title: t('dashboard.title') };

export default function Page() {
  return <DashboardPage />;
}
