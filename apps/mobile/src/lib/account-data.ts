import type { QueryClient } from '@tanstack/react-query';

import { documentStore } from './documents';
import { offlineScanner } from './offline-scan';
import { tripStore } from './trips';

/**
 * Everything this phone keeps for the signed-in account except its tokens (`SessionStore`):
 * the trip list, booking copies and saved documents (guest trips made here stay), offline
 * scanning keys and boardings, and cached queries. Runs on sign-out, account deletion and when
 * the API revokes the session.
 */
export function forgetAccountData(queryClient: QueryClient): void {
  const guestTrips = tripStore.deviceTripIds();
  tripStore.forgetAccount();
  documentStore.removeAllExcept(guestTrips);
  offlineScanner.forget();
  queryClient.clear();
}
