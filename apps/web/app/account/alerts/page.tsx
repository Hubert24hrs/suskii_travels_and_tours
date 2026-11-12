import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { AlertsSection } from '../../../components/account/membership-sections';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('alerts', '/account/alerts');
}

export default function AccountAlertsPage() {
  return <AlertsSection />;
}
