import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { TripsSection } from '../../../components/account/lists-section';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('trips', '/account/trips');
}

export default function AccountTripsPage() {
  return <TripsSection />;
}
