import { getMessages } from '@suskii/i18n';
import { BOOKING_TERMS_VERSION } from '@suskii/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { openHostedCheckout } from '../lib/payment';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import { MEMBERSHIP_BOOKING_ID, membershipBooking, primePlan, QUOTE_ID } from '../test/fixtures';

import { PrimeScreen } from './prime-screen';

jest.mock('../lib/payment', () => ({
  startPayment: jest.fn(() =>
    Promise.resolve({ kind: 'redirect', checkoutUrl: 'https://pay.example/checkout/1' }),
  ),
  openHostedCheckout: jest.fn(() => Promise.resolve()),
}));

const m = getMessages('en-NG');
const notMember = { member: false, current: null, terms: [] };

describe('PrimeScreen', () => {
  it('says memberships are not open when no plan is published', async () => {
    mockApi({ 'GET /v1/prime/plans': () => json({ plans: [] }) });
    await renderWithApp(<PrimeScreen />);
    expect(await screen.findByTestId('prime-coming-soon')).toHaveTextContent(m.prime.comingSoon);
  });

  it('shows plan prices and asks visitors to sign in to join', async () => {
    mockApi({ 'GET /v1/prime/plans': () => json({ plans: [primePlan] }) });
    await renderWithApp(<PrimeScreen />);

    const card = await screen.findByTestId('plan-suskii-prime-sample');
    expect(card).toHaveTextContent(/25,000/);
    expect(card).toHaveTextContent(m.prime.sample, { exact: false });
    await fireEvent.press(screen.getByTestId('prime-sign-in'));
    expect(router.push).toHaveBeenCalledWith('/sign-in');
  });

  it('joins with a membership booking and the hosted payment, then opens the trip', async () => {
    const { calls } = mockApi({
      'GET /v1/prime/plans': () => json({ plans: [primePlan] }),
      'GET /v1/me/prime': () => json(notMember),
      'POST /v1/inhouse-quotes': () => json({ quoteId: QUOTE_ID }, 201),
      'POST /v1/bookings': () =>
        json({ booking: membershipBooking({ status: 'PRICED' }), accessToken: null }, 201),
    });
    await renderWithApp(<PrimeScreen />, await signedInSession());

    await fireEvent.press(await screen.findByTestId('join-suskii-prime-sample'));
    // Name, email and phone start from the account.
    expect(screen.getByTestId('prime-given-names')).toHaveDisplayValue('Ada');
    expect(screen.getByTestId('prime-surname')).toHaveDisplayValue('Okafor');
    expect(screen.getByTestId('prime-continue')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('prime-terms'));
    await fireEvent.press(screen.getByTestId('prime-continue'));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/trips/${MEMBERSHIP_BOOKING_ID}`),
    );
    expect(openHostedCheckout).toHaveBeenCalledWith('https://pay.example/checkout/1');
    const quote = calls.find((request) => request.url.endsWith('/v1/inhouse-quotes'));
    expect(await quote?.json()).toEqual({
      kind: 'membership',
      planSlug: 'suskii-prime-sample',
      currency: 'NGN',
    });
    const booking = calls.find((request) => request.url.endsWith('/v1/bookings'));
    expect(booking?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await booking?.json()).toEqual({
      quoteId: QUOTE_ID,
      contact: { email: 'ada@example.com', phone: '+2348012345678' },
      guests: [{ givenNames: 'Ada', surname: 'Okafor' }],
      termsVersion: BOOKING_TERMS_VERSION,
      acceptTerms: true,
    });
  });

  it('shows the current term to members', async () => {
    mockApi({
      'GET /v1/prime/plans': () => json({ plans: [primePlan] }),
      'GET /v1/me/prime': () =>
        json({
          member: true,
          current: {
            plan: { slug: primePlan.slug, name: primePlan.name, period: 'year' },
            startsAt: '2026-10-05T10:00:00.000Z',
            until: '2027-10-05T10:00:00.000Z',
            benefits: primePlan.benefits,
          },
          terms: [],
        }),
    });
    await renderWithApp(<PrimeScreen />, await signedInSession());

    const member = await screen.findByTestId('prime-member');
    expect(member).toHaveTextContent(m.mobile.prime.memberBadge, { exact: false });
    expect(member).toHaveTextContent(/2027/);
  });
});
