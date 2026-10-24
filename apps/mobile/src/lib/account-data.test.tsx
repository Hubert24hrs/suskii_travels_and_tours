import { QueryClient } from '@tanstack/react-query';
import { act } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { Text } from 'react-native';

import { renderWithApp, USER_ID } from '../test/app';
import { BOOKING_ID, booking } from '../test/fixtures';

import { forgetAccountData } from './account-data';
import { openSecureCache, secureCache } from './cache';
import { documentStore } from './documents';
import { SessionStore } from './session';
import { summaryOf, tripStore } from './trips';

const ACCOUNT_BOOKING = '0192d3a0-7c1e-7b2a-9f00-0000000000bb';
const TICKET = {
  id: '0192d3a0-7c1e-7b2a-9f00-00000000d001',
  type: 'e_ticket',
  fileName: 'e-ticket.pdf',
} as const;

async function seedTrips(): Promise<void> {
  await tripStore.addGuestTrip(BOOKING_ID, 'guest-token-abcdefghijklmnop');
  tripStore.saveBooking(booking());
  tripStore.saveBooking(booking({ id: ACCOUNT_BOOKING }));
  tripStore.saveAccountTrips([summaryOf(booking({ id: ACCOUNT_BOOKING }))]);
  await documentStore.download(BOOKING_ID, TICKET, {});
  await documentStore.download(ACCOUNT_BOOKING, TICKET, {});
}

describe('forgetAccountData', () => {
  beforeEach(async () => {
    await openSecureCache();
    secureCache().clearAll();
  });

  it("deletes the account's trips and saved documents and keeps guest trips made here", async () => {
    await seedTrips();
    const accountFile = documentStore.saved(ACCOUNT_BOOKING)[0]?.uri ?? '';
    expect(new File(accountFile).exists).toBe(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    queryClient.setQueryData(['me'], { id: USER_ID });

    forgetAccountData(queryClient);

    expect(documentStore.saved(ACCOUNT_BOOKING)).toEqual([]);
    expect(new File(accountFile).exists).toBe(false);
    expect(tripStore.cachedBooking(ACCOUNT_BOOKING)).toBeNull();
    expect(tripStore.accountTrips()).toEqual([]);
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    // The guest trip, its copy and its e-ticket stay on the phone.
    expect(tripStore.cachedBooking(BOOKING_ID)).not.toBeNull();
    expect(documentStore.saved(BOOKING_ID)).toHaveLength(1);
  });

  it('runs when the API revokes the session, not only on sign-out', async () => {
    await seedTrips();
    const session = new SessionStore(() => Promise.resolve('invalid'));
    await session.save({
      status: 'authenticated',
      sessionId: '0192d3a0-7c1e-7b2a-9f00-00000000c002',
      accessTokenExpiresAt: '2026-10-05T10:15:00.000Z',
      refreshTokenExpiresAt: '2026-11-04T10:00:00.000Z',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: USER_ID,
        email: 'ada@example.com',
        emailVerified: true,
        phone: null,
        phoneVerified: false,
        displayName: 'Ada',
        roles: ['customer'],
        mfaEnabled: false,
        hasPassword: true,
      },
    });
    const queryClient = await renderWithApp(<Text>home</Text>, session);
    queryClient.setQueryData(['me'], { id: USER_ID });

    // A 401 makes the app refresh; the API answers that the session is gone.
    await act(() => session.refresh());

    expect(session.signedIn).toBe(false);
    expect(tripStore.accountTrips()).toEqual([]);
    expect(documentStore.saved(ACCOUNT_BOOKING)).toEqual([]);
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    expect(tripStore.cachedBooking(BOOKING_ID)).not.toBeNull();
  });
});
