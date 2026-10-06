import type { Metadata } from 'next';

import { UserDetailPage } from '../../../../components/pages/users';
import { t } from '../../../../lib/i18n';

export const metadata: Metadata = { title: t('users.title') };

export default async function Page({ params }: PageProps<'/users/[id]'>) {
  const { id } = await params;
  return <UserDetailPage userId={id} />;
}
