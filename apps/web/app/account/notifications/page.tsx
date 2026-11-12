import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { NotificationsSection } from '../../../components/account/notifications-section';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('notifications', '/account/notifications');
}

export default function AccountNotificationsPage() {
  return <NotificationsSection />;
}
