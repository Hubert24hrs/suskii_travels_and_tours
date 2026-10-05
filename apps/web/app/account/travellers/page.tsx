import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { TravellersSection } from '../../../components/account/lists-section';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('travellers', '/account/travellers');
}

export default function AccountTravellersPage() {
  return <TravellersSection />;
}
