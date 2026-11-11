import type { Metadata } from 'next';

import { AssistedQuotesPage } from '../../../components/pages/assisted-quotes';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('assistedQuotes.title') };

export default function Page() {
  return <AssistedQuotesPage />;
}
