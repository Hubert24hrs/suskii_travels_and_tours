import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { CombinedTripsSection } from '../../../components/account/combined-trips-section';
import { TripsSection } from '../../../components/account/lists-section';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('trips', '/account/trips');
}

/** Combined trips with their receipts (ADR-099), then every booking of the account. */
export default function AccountTripsPage() {
  return (
    <>
      <CombinedTripsSection />
      <TripsSection />
    </>
  );
}
