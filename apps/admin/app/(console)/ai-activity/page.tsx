import type { Metadata } from 'next';

import { AiActivityPage } from '../../../components/pages/ai-activity';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('aiActivity.title') };

export default function Page() {
  return <AiActivityPage />;
}
