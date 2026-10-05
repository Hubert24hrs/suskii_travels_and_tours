import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { PrimeSection } from '../../../components/account/membership-sections';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('prime', '/account/prime');
}

export default function AccountPrimePage() {
  return <PrimeSection />;
}
