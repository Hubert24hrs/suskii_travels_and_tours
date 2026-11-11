import type { Metadata } from 'next';

import { KnowledgePage } from '../../../components/pages/knowledge';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('knowledge.title') };

export default function Page() {
  return <KnowledgePage />;
}
