import type { Metadata } from 'next';

import { UsersPage } from '../../../components/pages/users';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('users.title') };

export default function Page() {
  return <UsersPage />;
}
