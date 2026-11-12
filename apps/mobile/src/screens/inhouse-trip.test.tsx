import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';

import { openSecureCache, secureCache } from '../lib/cache';
import { tripStore } from '../lib/trips';
import { json, mockApi, renderWithApp } from '../test/app';
import {
  ADDON_ID,
  APPLICATION_ID,
  BOOKING_ID,
  QUOTE_ID,
  addonCard,
  inhouseQuote,
  tourBooking,
  visaApplication,
} from '../test/fixtures';

import { TripAddonsScreen } from './trip-addons-screen';
import { TripScreen } from './trip-screen';
import { VisaApplicationScreen } from './visa-application-screen';

jest.mock('../lib/push', () => ({ followBooking: jest.fn(() => Promise.resolve(true)) }));

const m = getMessages('en-NG');
const TOKEN = 'guest-token-abcdefghijklmnopqrstuvwxyz';
const GET = `GET /v1/bookings/${BOOKING_ID}`;
const APPLICATION = `/v1/bookings/${BOOKING_ID}/visa-applications/${APPLICATION_ID}`;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

/** A request's raw body as bytes (the upload is not JSON). */
async function bodyBytes(request: Request | undefined): Promise<Uint8Array> {
  return new Uint8Array((await request?.arrayBuffer()) ?? new ArrayBuffer(0));
}

describe('in-house trips on mobile', () => {
  beforeEach(async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({
      id: BOOKING_ID,
      applicationId: APPLICATION_ID,
    });
    await openSecureCache();
    secureCache().clearAll();
    await tripStore.addGuestTrip(BOOKING_ID, TOKEN);
  });

  it('shows the tour, its voucher with a QR code that works offline, and the policy', async () => {
    mockApi({ [GET]: () => json(tourBooking()) });
    await renderWithApp(<TripScreen />);

    expect(await screen.findByTestId('voucher-code')).toHaveTextContent('U3N8-DCNR-NXZS-NXDA-293G');
    expect(screen.getByLabelText(/QR code for voucher U3N8-DCNR-NXZS-NXDA-293G/)).toBeOnTheScreen();
    expect(screen.getByTestId('inhouse-tour')).toHaveTextContent(/Dubai desert evening/);
    expect(screen.getByText(/Marina gate, Dubai Marina/)).toBeOnTheScreen();
    expect(
      screen.getByText('100% refund if you cancel at least 2 days before the start'),
    ).toBeOnTheScreen();
    // Saved for offline use, voucher included, like every trip.
    expect(tripStore.cachedBooking(BOOKING_ID)?.booking.voucher?.code).toBe(
      'U3N8-DCNR-NXZS-NXDA-293G',
    );
  });

  it('confirms the refund before cancelling under the policy', async () => {
    const { calls } = mockApi({
      [GET]: () => json(tourBooking()),
      [`POST /v1/bookings/${BOOKING_ID}/cancel`]: () =>
        json(tourBooking({ status: 'REFUND_PENDING', cancellation: null })),
    });
    await renderWithApp(<TripScreen />);

    await fireEvent.press(await screen.findByTestId('cancel-booking'));
    expect(
      screen.getByText('You get ₦95,000 back (100% of what you paid), to how you paid.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('cancel-confirm'));

    await waitFor(() =>
      expect(calls.some((request) => request.url.endsWith('/cancel'))).toBe(true),
    );
    const cancel = calls.find((request) => request.url.endsWith('/cancel'));
    expect(cancel?.headers.get('X-Booking-Token')).toBe(TOKEN);
  });

  it('opens extras for the trip and each visa application from the trip', async () => {
    const visaTrip = tourBooking({
      vertical: 'visa',
      tour: null,
      voucher: null,
      cancellation: null,
      visa: {
        product: {
          id: '0192d3a0-7c1e-7b2a-9f00-00000000c101',
          slug: 'sample-uae-tourist-visa',
          title: 'UAE tourist visa assistance (sample)',
          sample: true,
          artKey: null,
        },
        destination: 'AE',
        purpose: 'tourism',
        nationality: 'NG',
        travelDate: '2026-11-14',
        processingDaysMin: 3,
        processingDaysMax: 7,
        governmentFeeNote: null,
        travellers: { adults: 1, children: 0, infants: 0 },
        applications: [
          {
            id: APPLICATION_ID,
            applicantPosition: 0,
            status: 'awaiting_documents',
            submittedAt: null,
            updatedAt: '2026-10-05T12:00:00.000Z',
          },
        ],
      },
    });
    mockApi({ [GET]: () => json(visaTrip) });
    await renderWithApp(<TripScreen />);

    await fireEvent.press(await screen.findByTestId('visa-application-0'));
    expect(router.push).toHaveBeenCalledWith(`/trips/${BOOKING_ID}/visa/${APPLICATION_ID}`);
    await fireEvent.press(screen.getByTestId('add-extras'));
    expect(router.push).toHaveBeenCalledWith(`/trips/${BOOKING_ID}/addons`);
  });

  it('uploads a picked document as raw bytes, deletes the picker copy and submits', async () => {
    const pickedUri = 'file:///cache/DocumentPicker/passport.pdf';
    (File as unknown as { __write: (uri: string, bytes: Uint8Array) => void }).__write(
      pickedUri,
      PDF,
    );
    jest.mocked(getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: pickedUri,
          name: 'passport scan.pdf',
          mimeType: 'application/pdf',
          size: 8,
          lastModified: 0,
        },
      ],
    });
    let uploaded = false;
    let submitted = false;
    const clean = {
      id: '0192d3a0-7c1e-7b2a-9f00-00000000f0d1',
      checklistKey: 'passport_bio',
      status: 'clean' as const,
      contentType: 'application/pdf',
      sizeBytes: 8,
      fileName: 'passport-scan.pdf',
      uploadedAt: '2026-10-05T12:01:00.000Z',
    };
    const current = () => {
      const [passport, invitation] = visaApplication().checklist;
      return visaApplication({
        status: submitted ? 'submitted' : 'awaiting_documents',
        canUpload: !submitted,
        canSubmit: uploaded && !submitted,
        checklist: [{ ...passport!, document: uploaded ? clean : null }, invitation!],
      });
    };
    const { calls } = mockApi({
      [`GET ${APPLICATION}`]: () => json(current()),
      [`PUT ${APPLICATION}/documents/passport_bio`]: () => {
        uploaded = true;
        return json(current());
      },
      [`POST ${APPLICATION}/documents/${clean.id}/link`]: () =>
        json({
          url: `/v1/visa/documents/${clean.id}/content?expires=1&viewer=c.x&signature=s`,
          expiresAt: '2026-10-05T12:06:00.000Z',
        }),
      [`POST ${APPLICATION}/submit`]: () => {
        submitted = true;
        return json(current());
      },
    });
    await renderWithApp(<VisaApplicationScreen />);

    await fireEvent.press(await screen.findByTestId('visa-upload-passport_bio'));

    await screen.findByText(m.visa.application.documentStatus.clean);
    const put = calls.find((request) => request.method === 'PUT');
    expect(put?.headers.get('Content-Type')).toBe('application/pdf');
    expect(put?.headers.get('X-File-Name')).toBe('passport%20scan.pdf');
    expect(put?.headers.get('X-Booking-Token')).toBe(TOKEN);
    expect(await bodyBytes(put)).toEqual(PDF);
    // The picker's cache copy of the passport scan is gone once read.
    expect(new File(pickedUri).exists).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: /View passport-scan.pdf/ }));
    await waitFor(() =>
      expect(openBrowserAsync).toHaveBeenCalledWith(
        `http://localhost:4000/v1/visa/documents/${clean.id}/content?expires=1&viewer=c.x&signature=s`,
      ),
    );

    await fireEvent.press(screen.getByTestId('visa-submit'));
    expect(
      await screen.findByText(m.booking.inhouse.applicationStatus.submitted),
    ).toBeOnTheScreen();
  });

  it('refuses files that are not PDF, JPEG or PNG before uploading', async () => {
    jest.mocked(getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/notes.txt',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 3,
          lastModified: 0,
        },
      ],
    });
    const { calls } = mockApi({ [`GET ${APPLICATION}`]: () => json(visaApplication()) });
    await renderWithApp(<VisaApplicationScreen />);

    await fireEvent.press(await screen.findByTestId('visa-upload-passport_bio'));

    expect(await screen.findByRole('alert')).toHaveTextContent(m.visa.application.errors.type);
    expect(calls.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('links an add-on to the trip and quotes it with the link token', async () => {
    const { calls } = mockApi({
      'POST /v1/addon-links': () =>
        json(
          {
            linkToken: 'link-token-1',
            expiresAt: '2026-10-05T14:00:00.000Z',
            trip: {
              reference: 'DQPFWY',
              countryCode: 'AE',
              cityName: 'Dubai',
              startDate: '2026-11-07',
              endDate: '2026-11-07',
              travellers: { adults: 1, children: 0, infants: 0 },
            },
          },
          201,
        ),
      'GET /v1/addons': () => json({ addons: [addonCard] }),
      'POST /v1/inhouse-quotes': () => json({ ...inhouseQuote('tour'), quoteId: QUOTE_ID }, 201),
    });
    await renderWithApp(<TripAddonsScreen />);

    await fireEvent.press(await screen.findByTestId(`addon-add-${addonCard.slug}`));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`));
    const link = calls.find((request) => request.url.endsWith('/v1/addon-links'));
    expect(link?.headers.get('X-Booking-Token')).toBe(TOKEN);
    expect(await link?.json()).toEqual({ bookingId: BOOKING_ID });
    expect(
      new URL(calls.find((request) => request.method === 'GET')?.url ?? '').searchParams.get(
        'countryCode',
      ),
    ).toBe('AE');
    const quote = calls.find((request) => request.url.endsWith('/v1/inhouse-quotes'));
    expect(await quote?.json()).toEqual({
      kind: 'addon',
      addonId: ADDON_ID,
      startDate: '2026-11-07',
      endDate: '2026-11-07',
      travellers: { adults: 1, children: 0, infants: 0 },
      linkToken: 'link-token-1',
      cityId: null,
      currency: 'NGN',
    });
  });
});
