import type { Metadata } from 'next';

import { accountMetadata } from '../../components/account/account-metadata';
import { ProfileSection } from '../../components/account/profile-section';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('overview', '/account');
}

export default function AccountProfilePage() {
  return <ProfileSection />;
}
