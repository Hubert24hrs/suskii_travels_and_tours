import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { ReferralsSection } from '../../../components/account/membership-sections';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('referrals', '/account/referrals');
}

export default function AccountReferralsPage() {
  return <ReferralsSection />;
}
