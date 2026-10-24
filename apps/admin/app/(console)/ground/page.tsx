import type { Metadata } from 'next';

import { GroundPage } from '../../../components/pages/ground';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('ground.title') };

export default function Page() {
  return <GroundPage />;
}
