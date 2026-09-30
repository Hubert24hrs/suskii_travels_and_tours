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
});
