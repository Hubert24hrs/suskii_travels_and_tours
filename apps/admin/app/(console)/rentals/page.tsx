import type { Metadata } from 'next';

import { RentalsPage } from '../../../components/pages/rentals';
import { t } from '../../../lib/i18n';

export const metadata: Metadata = { title: t('rentals.title') };

export default function Page() {
  return <RentalsPage />;
}
