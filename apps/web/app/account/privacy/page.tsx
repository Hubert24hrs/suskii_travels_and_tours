import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { PrivacySection } from '../../../components/account/privacy-section';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('privacy', '/account/privacy');
}

export default function AccountPrivacyPage() {
  return <PrivacySection />;
}
