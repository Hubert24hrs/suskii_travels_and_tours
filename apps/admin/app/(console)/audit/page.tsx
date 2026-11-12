import type { Metadata } from 'next';

import { AuditPage } from '../../../components/pages/audit';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('audit.title') };

export default function Page() {
  return <AuditPage />;
}
