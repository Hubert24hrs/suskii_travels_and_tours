import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { SecuritySection } from '../../../components/account/security-section';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('security', '/account/security');
}

export default function AccountSecurityPage() {
  return <SecuritySection />;
}
