import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { shareAsync } from 'expo-sharing';

import { openSecureCache, secureCache } from '../lib/cache';
import { tripStore } from '../lib/trips';
import { json, mockApi, offline, renderWithApp } from '../test/app';
import { BOOKING_ID, booking } from '../test/fixtures';

import { TripScreen, shouldPoll } from './trip-screen';

jest.mock('../lib/push', () => ({ followBooking: jest.fn(() => Promise.resolve(true)) }));

const m = getMessages('en-NG');
const TOKEN = 'guest-token-abcdefghijklmnopqrstuvwxyz';
const GET = `GET /v1/bookings/${BOOKING_ID}`;
const heading = m.booking.heading.replace('{reference}', 'SK7Q2M');

describe('TripScreen', () => {
  beforeEach(async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
    await openSecureCache();
    secureCache().clearAll();
  });

  it('loads a guest trip with its stored token and keeps a copy for offline use', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    const { calls } = mockApi({ [GET]: () => json(booking()) });

    await renderWithApp(<TripScreen />);

    expect(await screen.findByRole('header', { name: heading })).toBeOnTheScreen();
    expect(screen.getByTestId('trip-status')).toHaveTextContent(m.booking.status.CONFIRMED);
    expect(screen.getByTestId('ticket-number')).toHaveTextContent(/0001234567890/);
    expect(calls[0]?.headers.get('X-Booking-Token')).toBe(TOKEN);
    expect(tripStore.cachedBooking(BOOKING_ID)?.booking.reference).toBe('SK7Q2M');
  });

  it('holds a company trip waiting for approval: no pay button until an approver says yes', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    mockApi({
      [GET]: () =>
        json(
          booking({
            status: 'PRICED',
            paymentOptions: null,
            company: {
              approvalStatus: 'pending',
              policyFindings: ['too_late'],
              approvalRejectReason: null,
            },
          }),
        ),
    });

    await renderWithApp(<TripScreen />);

    expect(await screen.findByTestId('trip-company')).toHaveTextContent(m.booking.company.pending);
    expect(
      screen.getByText(
        m.booking.company.outsidePolicy.replace('{findings}', m.booking.company.findings.too_late),
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('pay-now')).toBeNull();
  });

  it('saves the e-ticket to the device and opens it from there', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    mockApi({ [GET]: () => json(booking()) });
    await renderWithApp(<TripScreen />);

    await fireEvent.press(await screen.findByTestId('document-save'));

    expect(await screen.findByTestId('document-saved')).toBeOnTheScreen();
    const [url, destination, options] = jest.mocked(File.downloadFileAsync).mock.calls[0] ?? [];
    expect(url).toBe(
      `http://localhost:4000/v1/bookings/${BOOKING_ID}/documents/${booking().documents[0]?.id}`,
    );
    expect((destination as File).uri).toBe(
      `file:///data/documents/trips/${BOOKING_ID}/SK7Q2M-e-ticket.pdf`,
    );
    expect(options).toMatchObject({ headers: { 'X-Booking-Token': TOKEN }, idempotent: true });

    await fireEvent.press(screen.getByTestId('document-open'));
    expect(shareAsync).toHaveBeenCalledWith(
      `file:///data/documents/trips/${BOOKING_ID}/SK7Q2M-e-ticket.pdf`,
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
  });

  it('shows the saved copy when the phone is offline', async () => {
    tripStore.saveBooking(booking(), new Date('2026-10-02T10:00:00Z'));
    mockApi({ [GET]: offline });

    await renderWithApp(<TripScreen />);

    expect(await screen.findByText(m.mobile.offline)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: heading })).toBeOnTheScreen();
    // No actions that need the network while offline.
    expect(screen.queryByRole('button', { name: m.mobile.trip.notify })).toBeNull();
  });

  it('cancels a ticketed flight after showing the airline refund it confirms', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    let cancelled = false;
    const refund = { amountMinor: 7_000_000, currency: 'NGN' };
    const { calls } = mockApi({
      [GET]: () =>
        json(
          cancelled
            ? booking({ status: 'REFUND_PENDING', flightCancellable: false })
            : booking({ flightCancellable: true }),
        ),
      [`POST /v1/bookings/${BOOKING_ID}/cancellation-quote`]: () =>
        json({
          refund,
          kept: { amountMinor: 1_500_000, currency: 'NGN' },
          expiresAt: '2026-10-01T09:30:00.000Z',
        }),
      [`POST /v1/bookings/${BOOKING_ID}/cancel`]: () => {
        cancelled = true;
        return json(booking({ status: 'REFUND_PENDING', flightCancellable: false }));
      },
    });
    await renderWithApp(<TripScreen />);

    await fireEvent.press(await screen.findByTestId('cancel-flight'));
    expect(await screen.findByText(/70,000 is refunded to how you paid/)).toBeOnTheScreen();
    expect(screen.getByText(/15,000 of what you paid is not refundable/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('cancel-flight-confirm'));

    expect(await screen.findByText(m.booking.status.REFUND_PENDING)).toBeOnTheScreen();
    expect(screen.queryByTestId('cancel-flight')).toBeNull();
    const cancel = calls.find((request) => request.url.endsWith('/cancel'));
    expect(cancel?.headers.get('X-Booking-Token')).toBe(TOKEN);
    expect(await cancel?.json()).toEqual({ refund });
  });

  it('sends a flight the airline will not cancel online to support', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    mockApi({
      [GET]: () => json(booking({ flightCancellable: true })),
      [`POST /v1/bookings/${BOOKING_ID}/cancellation-quote`]: () =>
        json(
          {
            type: 'urn:suskii:problem:not-cancellable',
            title: 'This booking cannot be cancelled online',
            status: 409,
          },
          409,
        ),
    });
    await renderWithApp(<TripScreen />);
    await fireEvent.press(await screen.findByTestId('cancel-flight'));
    expect(await screen.findByText(m.booking.flightCancel.notOnline)).toBeOnTheScreen();
  });

  it("shows the airline's new times and accepts them for the traveller", async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    const booked = booking().flight?.slices[0];
    if (!booked) throw new Error('the fixture has a flight');
    const moved = {
      ...booked,
      departureLocal: `${booked.departureLocal.slice(0, 11)}23:55`,
      segments: booked.segments.map((segment) => ({ ...segment, flightNumber: '999' })),
    };
    const change = {
      id: '01900000-0000-7000-8000-00000000aaaa',
      status: 'open' as const,
      acceptable: true,
      significant: false,
      refundOffer: null,
      detectedAt: '2026-10-02T09:00:00.000Z',
      previous: [booked],
      updated: [moved],
    };
    let accepted = false;
    const { calls } = mockApi({
      [GET]: () =>
        json(
          booking({
            scheduleChange: accepted
              ? { ...change, status: 'accepted', acceptable: false }
              : change,
          }),
        ),
      [`POST /v1/bookings/${BOOKING_ID}/schedule-changes/${change.id}/accept`]: () => {
        accepted = true;
        return json(booking({ scheduleChange: { ...change, status: 'accepted' } }));
      },
    });
    await renderWithApp(<TripScreen />);

    expect(await screen.findByTestId('schedule-change')).toBeOnTheScreen();
    expect(screen.getByTestId('schedule-change-now')).toHaveTextContent(/ 999: departs .* 23:55/);
    await fireEvent.press(screen.getByTestId('schedule-change-accept'));

    expect(await screen.findByText(m.booking.scheduleChange.accepted)).toBeOnTheScreen();
    expect(screen.queryByTestId('schedule-change')).toBeNull();
    const accept = calls.find((request) => request.url.endsWith('/accept'));
    expect(accept?.headers.get('X-Booking-Token')).toBe(TOKEN);
  });

  it('sends a change the airline will not take online to support', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    const booked = booking().flight?.slices[0];
    if (!booked) throw new Error('the fixture has a flight');
    mockApi({
      [GET]: () =>
        json(
          booking({
            scheduleChange: {
              id: '01900000-0000-7000-8000-00000000bbbb',
              status: 'open',
              acceptable: false,
              significant: false,
              refundOffer: null,
              detectedAt: '2026-10-02T09:00:00.000Z',
              previous: [booked],
              updated: [],
            },
          }),
        ),
    });
    await renderWithApp(<TripScreen />);
    expect(await screen.findByText(m.booking.scheduleChange.support)).toBeOnTheScreen();
    expect(screen.getByText(m.booking.scheduleChange.removed, { exact: false })).toBeOnTheScreen();
    expect(screen.queryByTestId('schedule-change-accept')).toBeNull();
  });

  it('offers everything back for a cancelled flight and takes the refund after confirmation', async () => {
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
    const booked = booking().flight?.slices[0];
    if (!booked) throw new Error('the fixture has a flight');
    const amount = { amountMinor: 8_500_000, currency: 'NGN' };
    const change = {
      id: '01900000-0000-7000-8000-00000000cccc',
      status: 'open' as const,
      acceptable: false,
      significant: true,
      refundOffer: { amount },
      detectedAt: '2026-10-02T09:00:00.000Z',
      previous: [booked],
      updated: [],
    };
    let refunded = false;
    const refundedBooking = () =>
      booking({
        status: 'REFUND_PENDING',
        scheduleChange: { ...change, status: 'cancelled', refundOffer: null },
      });
    const { calls } = mockApi({
      [GET]: () => json(refunded ? refundedBooking() : booking({ scheduleChange: change })),
      [`POST /v1/bookings/${BOOKING_ID}/schedule-changes/${change.id}/refund`]: () => {
        refunded = true;
        return json(refundedBooking());
      },
    });
    await renderWithApp(<TripScreen />);

    expect(await screen.findByText(m.booking.scheduleChange.significant)).toBeOnTheScreen();
    // A cancelled flight cannot be accepted, and support is not the only way out.
    expect(screen.queryByTestId('schedule-change-accept')).toBeNull();
    expect(screen.queryByText(m.booking.scheduleChange.support)).toBeNull();
    await fireEvent.press(screen.getByTestId('schedule-change-refund'));
    expect(await screen.findByText(m.booking.scheduleChange.refundTitle)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('schedule-change-refund-confirm'));

    expect(await screen.findByText(/Your flights are cancelled/)).toBeOnTheScreen();
    const request = calls.find((call) => call.url.endsWith('/refund'));
    expect(request?.headers.get('X-Booking-Token')).toBe(TOKEN);
    expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await request?.json()).toEqual({ refund: amount });
    expect(screen.queryByTestId('schedule-change')).toBeNull();
  });

  it('explains a booking this phone cannot open', async () => {
    mockApi({
      [GET]: () =>
        json({ type: 'urn:suskii:problem:not-found', title: 'Not found', status: 404 }, 404),
    });

    await renderWithApp(<TripScreen />);

    expect(await screen.findByText(m.booking.notFound.heading)).toBeOnTheScreen();
  });
});

describe('shouldPoll', () => {
  it('polls while payment, ticketing or a refund is in flight', () => {
    expect(shouldPoll(booking({ status: 'TICKETING' }))).toBe(true);
    expect(shouldPoll(booking({ status: 'REFUND_PENDING' }))).toBe(true);
    expect(shouldPoll(booking({ status: 'CONFIRMED' }))).toBe(false);
    expect(shouldPoll(booking({ status: 'CANCELLED' }))).toBe(false);
  });

  it('polls a just-confirmed booking until its documents exist', () => {
    const confirmed = Date.parse('2026-10-01T09:05:00.000Z');
    const waiting = booking({ status: 'CONFIRMED', documents: [] });
    expect(shouldPoll(waiting, confirmed + 10_000)).toBe(true);
    expect(shouldPoll(waiting, confirmed + 4 * 60_000)).toBe(false);
    expect(shouldPoll(booking({ status: 'CONFIRMED' }), confirmed + 10_000)).toBe(false);
    // Memberships have no document to wait for.
    expect(shouldPoll({ ...waiting, vertical: 'prime' }, confirmed + 10_000)).toBe(false);
  });
});
