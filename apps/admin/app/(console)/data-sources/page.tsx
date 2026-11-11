import type { Metadata } from 'next';

import { DataSourcesPage } from '../../../components/pages/data-sources';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('dataSources.title') };

export default function Page() {
  return <DataSourcesPage />;
}
