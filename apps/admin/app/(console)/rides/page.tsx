import type { Metadata } from 'next';

import { RidesPage } from '../../../components/pages/rides';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('rides.title') };

export default function Page() {
  return <RidesPage />;
}
