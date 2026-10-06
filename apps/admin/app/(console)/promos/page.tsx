import type { Metadata } from 'next';

import { PromosPage } from '../../../components/pages/promos';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('promos.title') };

export default function Page() {
  return <PromosPage />;
}
