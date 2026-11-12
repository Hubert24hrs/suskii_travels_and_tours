import type { Metadata } from 'next';

import { StatusIncidentsPage } from '../../../components/pages/status';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('status.title') };

export default function Page() {
  return <StatusIncidentsPage />;
}
