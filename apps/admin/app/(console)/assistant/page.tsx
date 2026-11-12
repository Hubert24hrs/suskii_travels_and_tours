import type { Metadata } from 'next';

import { StaffAssistantPage } from '../../../components/pages/assistant';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('assistant.title') };

export default function Page() {
  return <StaffAssistantPage />;
}
