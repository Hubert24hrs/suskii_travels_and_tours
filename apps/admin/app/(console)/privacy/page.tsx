import type { Metadata } from 'next';

import { PrivacyPage } from '../../../components/pages/privacy';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('privacy.title') };

export default function Page() {
  return <PrivacyPage />;
}
