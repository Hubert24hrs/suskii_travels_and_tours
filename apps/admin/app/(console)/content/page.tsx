import type { Metadata } from 'next';

import { ContentPage } from '../../../components/pages/content';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('content.title') };

export default function Page() {
  return <ContentPage />;
}
