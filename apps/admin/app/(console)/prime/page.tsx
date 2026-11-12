import type { Metadata } from 'next';

import { PrimePage } from '../../../components/pages/prime';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('prime.title') };

export default function Page() {
  return <PrimePage />;
}
