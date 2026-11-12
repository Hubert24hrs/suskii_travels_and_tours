import type { Metadata } from 'next';

import { ApprovalsPage } from '../../../components/pages/approvals';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('approvals.title') };

export default function Page() {
  return <ApprovalsPage />;
}
