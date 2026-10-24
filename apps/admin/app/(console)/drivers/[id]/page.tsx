import type { Metadata } from 'next';

import { DriverDetailPage } from '../../../../components/pages/drivers';
import { t } from '../../../../lib/i18n';

export const metadata: Metadata = { title: t('drivers.title') };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverDetailPage driverId={id} />;
}
