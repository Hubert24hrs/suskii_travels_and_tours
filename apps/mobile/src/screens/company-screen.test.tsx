import { getMessages } from '@suskii/i18n';
import type { Schemas } from '@suskii/api-client';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { json, mockApi, renderWithApp, signedInSession } from '../test/app';

import { CompanyScreen } from './company-screen';

const m = getMessages('en-NG');
const TRIP_ID = '0192d3a0-7c1e-7b2a-9f00-00000000d001';

const company = (patch: Partial<Schemas['Company']> = {}): Schemas['Company'] => ({
  id: '0192d3a0-7c1e-7b2a-9f00-00000000d100',
  name: 'Acme Logistics',
  countryCode: 'NG',
  registrationNumber: null,
  taxId: null,
  billingEmail: 'accounts@acme.test',
  status: 'active',
  myRole: 'approver',
  policy: {
    hotelNightlyCap: null,
    maxCabin: null,
    minAdvanceDays: 14,
    approvalMode: 'out_of_policy',
  },
  createdAt: '2026-10-01T09:00:00.000Z',
  ...patch,
});

const trip = (patch: Partial<Schemas['CompanyBooking']> = {}): Schemas['CompanyBooking'] => ({
  id: TRIP_ID,
  reference: 'SK7Q2M',
  status: 'PRICED',
  vertical: 'tours',
  createdAt: '2026-10-27T09:00:00.000Z',
  total: { amountMinor: 3_000_000, currency: 'NGN' },
  startsOn: '2026-11-06',
  endsOn: null,
  flight: null,
  hotel: null,
  product: { title: 'Lagos walking tour', cityName: 'Lagos', countryCode: 'NG' },
  travellerName: 'CHIDI OKAFOR',
  bookerName: 'Chidi',
  bookedByMe: false,
  approvalStatus: 'pending',
  approvalRejectReason: null,
  policyFindings: ['too_late'],
  canDecide: true,
  ...patch,
});

describe('CompanyScreen', () => {
  it('says how to get a company when the account has none', async () => {
    mockApi({ 'GET /v1/me/company': () => json({ type: 'not-found', status: 404 }, 404) });
    await renderWithApp(<CompanyScreen />, await signedInSession());

    expect(await screen.findByTestId('company-none')).toBeOnTheScreen();
    expect(screen.getByText(m.account.company.none)).toBeOnTheScreen();
  });

  it('lets an approver approve a waiting trip', async () => {
    let decided = false;
    const { calls } = mockApi({
      'GET /v1/me/company': () => json(company()),
      'GET /v1/me/company/bookings': () =>
        json({
          items: [decided ? trip({ approvalStatus: 'approved', canDecide: false }) : trip()],
          nextCursor: null,
        }),
      [`POST /v1/me/company/bookings/${TRIP_ID}/approve`]: () => {
        decided = true;
        return json(trip({ approvalStatus: 'approved', canDecide: false }));
      },
    });
    await renderWithApp(<CompanyScreen />, await signedInSession());

    expect(await screen.findByTestId('company-role')).toHaveTextContent(
      m.account.company.yourRole.replace('{role}', m.account.company.roles.approver),
    );
    expect(
      within(screen.getByTestId(`company-trip-${TRIP_ID}`)).getByText(
        m.booking.company.status.pending,
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`approve-${TRIP_ID}`));

    await waitFor(() =>
      expect(screen.getByText(m.account.company.approvals.empty)).toBeOnTheScreen(),
    );
    expect(screen.getByText(m.booking.company.status.approved)).toBeOnTheScreen();
    expect(calls.some((call) => call.url.endsWith(`/bookings/${TRIP_ID}/approve`))).toBe(true);
  });

  it('rejects with the reason the approver chose', async () => {
    const { calls } = mockApi({
      'GET /v1/me/company': () => json(company()),
      'GET /v1/me/company/bookings': () => json({ items: [trip()], nextCursor: null }),
      [`POST /v1/me/company/bookings/${TRIP_ID}/reject`]: () =>
        json(trip({ status: 'CANCELLED', approvalStatus: 'rejected', canDecide: false })),
    });
    await renderWithApp(<CompanyScreen />, await signedInSession());

    await fireEvent.press(await screen.findByTestId(`reject-reason-${TRIP_ID}-over_budget`));
    await fireEvent.press(screen.getByTestId(`reject-${TRIP_ID}`));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith(`/bookings/${TRIP_ID}/reject`))).toBe(true),
    );
    const reject = calls.find((call) => call.url.endsWith(`/bookings/${TRIP_ID}/reject`));
    expect(await reject?.json()).toEqual({ reason: 'over_budget' });
  });

  it('shows travellers their company trips without approval controls', async () => {
    mockApi({
      'GET /v1/me/company': () => json(company({ myRole: 'traveller' })),
      'GET /v1/me/company/bookings': () =>
        json({ items: [trip({ canDecide: false, bookedByMe: true })], nextCursor: null }),
    });
    await renderWithApp(<CompanyScreen />, await signedInSession());

    expect(await screen.findByTestId(`company-trip-${TRIP_ID}`)).toBeOnTheScreen();
    expect(screen.queryByText(m.account.company.approvals.heading)).toBeNull();
    expect(screen.queryByTestId(`approve-${TRIP_ID}`)).toBeNull();
  });
});
