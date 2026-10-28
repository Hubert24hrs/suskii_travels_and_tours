import type { Metadata } from 'next';

import { SupportInboxPage } from '../../../components/pages/support';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('support.title') };

export default function Page() {
  return <SupportInboxPage />;
}
