import type { Metadata } from 'next';

import { VisaApplicationPage } from '../../../../components/pages/visa';
import { t } from '../../../../lib/i18n';

export const metadata: Metadata = { title: t('visa.title') };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VisaApplicationPage applicationId={id} />;
}
