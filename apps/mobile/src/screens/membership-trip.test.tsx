import { getMessages } from '@suskii/i18n';
import { screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import { MEMBERSHIP_BOOKING_ID, membershipBooking } from '../test/fixtures';

import { TripScreen } from './trip-screen';

jest.mock('../lib/push', () => ({ followBooking: jest.fn(() => Promise.resolve(true)) }));

const m = getMessages('en-NG');
const GET = `GET /v1/bookings/${MEMBERSHIP_BOOKING_ID}`;

describe('TripScreen for a Suskii Prime membership', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: MEMBERSHIP_BOOKING_ID });
  });

  it('offers payment while the membership is priced', async () => {
    const confirmed = membershipBooking();
    const priced = membershipBooking({
      status: 'PRICED',
      confirmedAt: null,
      paid: { amountMinor: 0, currency: 'NGN' },
      membership: confirmed.membership && { ...confirmed.membership, term: null },
    });
    mockApi({ [GET]: () => json(priced) });
    await renderWithApp(<TripScreen />, await signedInSession());

    const card = await screen.findByTestId('trip-membership');
    expect(card).toHaveTextContent(m.booking.membership.pending, { exact: false });
    expect(screen.getByTestId('pay-now')).toHaveTextContent(m.booking.retryPayment);
  });

  it('shows the term once confirmed', async () => {
    mockApi({ [GET]: () => json(membershipBooking()) });
    await renderWithApp(<TripScreen />, await signedInSession());

    const card = await screen.findByTestId('trip-membership');
    expect(card).toHaveTextContent('Suskii Prime (sample)', { exact: false });
    expect(card).toHaveTextContent(/5 Oct 2026.*5 Oct 2027/);
    expect(screen.queryByTestId('pay-now')).toBeNull();
  });
});
