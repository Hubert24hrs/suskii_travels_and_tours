import type { Metadata } from 'next';

import { AiControlPage } from '../../../components/pages/ai';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('ai.title') };

export default function Page() {
  return <AiControlPage />;
}
