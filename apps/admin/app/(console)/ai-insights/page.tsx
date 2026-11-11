import type { Metadata } from 'next';

import { AiInsightsPage } from '../../../components/pages/ai-insights';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('aiInsights.title') };

export default function Page() {
  return <AiInsightsPage />;
}
