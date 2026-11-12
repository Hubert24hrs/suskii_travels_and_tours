import type { Metadata } from 'next';

import { CatalogPage } from '../../../components/pages/catalog';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('catalog.title') };

export default function Page() {
  return <CatalogPage />;
}
