import type { Metadata } from 'next';

import { SupportConversationPage } from '../../../../components/pages/support';
import { t } from '../../../../lib/i18n';

export const metadata: Metadata = { title: t('support.title') };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupportConversationPage conversationId={id} />;
}
