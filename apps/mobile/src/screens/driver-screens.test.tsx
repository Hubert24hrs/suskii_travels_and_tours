import { getMessages } from '@suskii/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as camera from 'expo-camera';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';

import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import {
  OFFER_ID,
  RIDE_ID,
  VEHICLE_ID,
  driverEarnings,
  driverProfile,
  driverRide,
  rideOffer,
  ridePlaces,
} from '../test/fixtures';

import { DriverScreen } from './driver-screen';
import { OperatorScanScreen } from './operator-scan-screen';

const m = getMessages('en-NG');
/** Puts a picked file in the mocked file system (jest.setup.js). */
const writeFile = (uri: string, bytes: Uint8Array): void =>
  (File as unknown as { __write: (uri: string, bytes: Uint8Array) => void }).__write(uri, bytes);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PAYLOAD = 'SUSKII-T1.eyJ0aWNrZXQiOiJzYW1wbGUifQ.c2lnbmF0dXJl';
const notFound = () =>
  json({ type: 'urn:suskii:problem:not-found', title: 'Not found', status: 404 }, 404);

/** The camera mock keeps the last `onBarcodeScanned` it rendered with. */
const scanner = (
  camera as unknown as { __camera: { onBarcodeScanned: ((scan: { data: string }) => void) | null } }
).__camera;

describe('driver mode', () => {
  it('sends an application, then shows what is still to do', async () => {
    let applied = false;
    const { calls } = mockApi({
      'GET /v1/drivers/me/profile': () => (applied ? json(driverProfile()) : notFound()),
      'GET /v1/rides/places': () => json(ridePlaces),
      'POST /v1/drivers/applications': () => {
        applied = true;
        return json(driverProfile(), 201);
      },
    });
    await renderWithApp(<DriverScreen />, await signedInSession());

    await fireEvent.changeText(await screen.findByTestId('driver.givenNames'), 'Chinedu');
    await fireEvent.changeText(screen.getByTestId('driver.surname'), 'Okeke');
    await fireEvent.changeText(screen.getByTestId('driver.dateOfBirth'), '1990-04-12');
    await fireEvent.press(await screen.findByTestId('driver.cityName-Lagos'));
    await fireEvent.changeText(screen.getByTestId('driver.nin'), '123 4567 8901');
    await fireEvent.changeText(screen.getByTestId('driver.licenceNumber'), 'lag12345ab67');
    await fireEvent.changeText(screen.getByTestId('driver.licenceExpiresOn'), '2031-06-30');
    await fireEvent.press(screen.getByTestId('driver-apply-submit'));

    expect(await screen.findByTestId('driver-progress')).toHaveTextContent(
      new RegExp(m.mobile.cars.driver.status.pending),
    );
    expect(screen.getByText(`• ${m.mobile.cars.driver.missing.documents}`)).toBeOnTheScreen();
    const sent = calls.find((request) => request.url.endsWith('/v1/drivers/applications'));
    expect(await sent?.json()).toEqual({
      givenNames: 'Chinedu',
      surname: 'Okeke',
      dateOfBirth: '1990-04-12',
      cityName: 'Lagos',
      nin: '12345678901',
      licenceNumber: 'LAG12345AB67',
      licenceExpiresOn: '2031-06-30',
    });
  });

  it('checks the application before sending it', async () => {
    const { calls } = mockApi({
      'GET /v1/drivers/me/profile': notFound,
      'GET /v1/rides/places': () => json(ridePlaces),
    });
    await renderWithApp(<DriverScreen />, await signedInSession());
    await fireEvent.changeText(await screen.findByTestId('driver.nin'), '1234');
    await fireEvent.press(screen.getByTestId('driver-apply-submit'));
    expect(screen.getByRole('alert')).toHaveTextContent(m.mobile.cars.driver.applyErrors.invalid);
    expect(calls.some((request) => request.method === 'POST')).toBe(false);
  });

  it('uploads a document from the picker and adds a vehicle', async () => {
    const pickedUri = 'file:///data/cache/DocumentPicker/licence.png';
    writeFile(pickedUri, PNG);
    jest.mocked(getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: pickedUri, name: 'licence.png', mimeType: 'image/png', size: 8, lastModified: 0 },
      ],
    });
    let profile = driverProfile();
    const { calls } = mockApi({
      'GET /v1/drivers/me/profile': () => json(profile),
      'GET /v1/rides/places': () => json(ridePlaces),
      'PUT /v1/drivers/me/documents/licence': () => {
        profile = driverProfile({
          documents: [
            {
              id: '0192d3a0-7c1e-7b2a-9f00-00000000c403',
              kind: 'licence',
              status: 'pending',
              contentType: 'image/png',
              sizeBytes: 8,
              rejectionReason: null,
              createdAt: '2026-10-01T09:00:00.000Z',
              reviewedAt: null,
            },
          ],
        });
        return json(profile);
      },
      'POST /v1/drivers/me/vehicles': () => {
        profile = driverProfile({
          ...profile,
          vehicles: [
            {
              id: VEHICLE_ID,
              make: 'Toyota',
              model: 'Camry',
              year: 2018,
              colour: 'Black',
              plate: 'KJA-123-AB',
              category: 'standard',
              seats: 4,
              insuranceExpiresOn: '2030-12-31',
              status: 'pending',
              active: false,
            },
          ],
        });
        return json(profile, 201);
      },
    });
    await renderWithApp(<DriverScreen />, await signedInSession());

    await fireEvent.press(await screen.findByTestId('upload-licence'));
    await waitFor(() =>
      expect(screen.getByTestId('document-licence')).toHaveTextContent(
        m.mobile.cars.driver.documentStatuses.pending,
      ),
    );
    const upload = calls.find((request) => request.method === 'PUT');
    expect(upload?.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await upload!.arrayBuffer())).toEqual(PNG);
    expect(new File(pickedUri).exists).toBe(false);

    await fireEvent.changeText(screen.getByTestId('vehicle.make'), 'Toyota');
    await fireEvent.changeText(screen.getByTestId('vehicle.model'), 'Camry');
    await fireEvent.changeText(screen.getByTestId('vehicle.year'), '2018');
    await fireEvent.changeText(screen.getByTestId('vehicle.colour'), 'Black');
    await fireEvent.changeText(screen.getByTestId('vehicle.plate'), 'kja-123-ab');
    await fireEvent.changeText(screen.getByTestId('vehicle.insuranceExpiresOn'), '2030-12-31');
    await fireEvent.press(screen.getByTestId('vehicle-add'));

    expect(await screen.findByText('Black Toyota Camry (2018), KJA-123-AB')).toBeOnTheScreen();
    const vehicle = calls.find((request) => request.url.endsWith('/v1/drivers/me/vehicles'));
    expect(await vehicle?.json()).toEqual({
      make: 'Toyota',
      model: 'Camry',
      year: 2018,
      colour: 'Black',
      plate: 'KJA-123-AB',
      category: 'standard',
      seats: 4,
      insuranceExpiresOn: '2030-12-31',
    });
  });

  it('asks an approved driver to sign in again before driver mode switches on', async () => {
    mockApi({
      'GET /v1/drivers/me/profile': () => json(driverProfile({ status: 'approved', missing: [] })),
    });
    await renderWithApp(<DriverScreen />, await signedInSession());
    expect(await screen.findByText(m.mobile.cars.driver.signInAgain)).toBeOnTheScreen();
    expect(screen.queryByTestId('driver-console')).toBeNull();
  });

  it('goes online at a pick-up point, accepts an offer and starts with the PIN', async () => {
    let online = false;
    let currentRideId: string | null = null;
    let pins = 0;
    const { calls } = mockApi({
      'GET /v1/drivers/me/profile': () => json(driverProfile({ status: 'approved', missing: [] })),
      'GET /v1/rides/places': () => json(ridePlaces),
      'GET /v1/drivers/me/state': () => json({ online, currentRideId }),
      'GET /v1/drivers/me/offers': () => json({ offers: [rideOffer] }),
      'GET /v1/drivers/me/ride': () => json({ ride: currentRideId ? driverRide() : null }),
      'GET /v1/drivers/me/earnings': () => json(driverEarnings),
      'POST /v1/drivers/me/online': () => {
        online = true;
        return json({ online, currentRideId });
      },
      [`POST /v1/drivers/me/offers/${OFFER_ID}/accept`]: () => {
        currentRideId = RIDE_ID;
        return json(driverRide({ status: 'assigned', arrivedAt: null }));
      },
      [`POST /v1/drivers/me/rides/${RIDE_ID}/start`]: () => {
        pins += 1;
        return pins === 1
          ? json(
              {
                type: 'urn:suskii:problem:pin-invalid',
                title: 'That PIN is not right',
                status: 422,
                attemptsLeft: 4,
              },
              422,
            )
          : json(driverRide({ status: 'in_progress', startedAt: '2026-10-01T09:06:00.000Z' }));
      },
    });
    await renderWithApp(<DriverScreen />, await signedInSession({ roles: ['customer', 'driver'] }));

    expect(await screen.findByTestId('driver-online')).toHaveTextContent(
      m.mobile.cars.driver.offline,
    );
    expect(await screen.findByTestId('driver-earnings')).toHaveTextContent(/Balance: ₦4,800/);
    await fireEvent.press(
      await screen.findByTestId(`driver-where-${ridePlaces.places[0]?.id ?? ''}`),
    );
    await fireEvent.press(screen.getByTestId('driver-go-online'));
    expect(await screen.findByText(m.mobile.cars.driver.online)).toBeOnTheScreen();
    const went = calls.find((request) => request.url.endsWith('/online'));
    expect(await went?.json()).toEqual({ position: { lat: 6.5095, lng: 3.3711 } });

    await fireEvent.press(await screen.findByTestId(`offer-accept-${OFFER_ID}`));
    expect(await screen.findByTestId('driver-ride')).toHaveTextContent(/Rider: Ada/);

    await fireEvent.changeText(await screen.findByTestId('driver-pin'), '1111');
    await fireEvent.press(screen.getByTestId('driver-start'));
    expect(await screen.findByRole('alert')).toHaveTextContent(m.mobile.cars.driver.pinWrong);
    await fireEvent.changeText(screen.getByTestId('driver-pin'), '4827');
    await fireEvent.press(screen.getByTestId('driver-start'));
    await waitFor(() => expect(pins).toBe(2));
    const start = calls.filter((request) => request.url.endsWith('/start')).at(-1);
    expect(await start?.json()).toEqual({ pin: '4827' });
  });
});

describe('operator ticket scanning', () => {
  it('is only for operator agents', async () => {
    mockApi({});
    await renderWithApp(<OperatorScanScreen />, await signedInSession());
    expect(await screen.findByText(m.mobile.cars.operator.notAgent)).toBeOnTheScreen();
  });

  it('boards a pasted ticket, then refuses the second scan of the same ticket', async () => {
    let scans = 0;
    const { calls } = mockApi({
      'GET /v1/operator/trips': () =>
        json({
          trips: [
            {
              id: '0192d3a0-7c1e-7b2a-9f00-00000000c101',
              operatorName: 'Lagoon Express',
              origin: 'Lagos',
              destination: 'Ibadan',
              departsAtLocal: '2026-11-02T07:00',
              status: 'boarding',
              seatCount: 14,
              sold: 2,
              boarded: scans > 0 ? 1 : 0,
            },
          ],
        }),
      'POST /v1/operator/tickets/scan': () => {
        scans += 1;
        const ticket = {
          id: '0192d3a0-7c1e-7b2a-9f00-00000000c131',
          tripId: '0192d3a0-7c1e-7b2a-9f00-00000000c101',
          seatNumber: '1A',
          passengerName: 'Ada Okafor',
          boardedAt: '2026-11-02T06:40:00.000Z',
        };
        return json(
          scans === 1
            ? { result: 'boarded', reason: null, ticket }
            : { result: 'already_boarded', reason: null, ticket },
        );
      },
    });
    await renderWithApp(
      <OperatorScanScreen />,
      await signedInSession({ roles: ['customer', 'operator_agent'] }),
    );

    expect(await screen.findByText(/07:00 Lagos to Ibadan/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('scan-manual'), `  ${PAYLOAD}  `);
    await fireEvent.press(screen.getByTestId('scan-check'));
    expect(await screen.findByTestId('scan-result')).toHaveTextContent(
      'Boarded: seat 1A, Ada Okafor',
    );
    const scan = calls.find((request) => request.url.endsWith('/scan'));
    expect(await scan?.json()).toEqual({ qrPayload: PAYLOAD });
    expect(await screen.findByText('1 of 2 boarded')).toBeOnTheScreen();

    // The next pass comes from the camera; the same ticket again is refused.
    await fireEvent.press(screen.getByTestId('scan-another'));
    await waitFor(() => expect(scanner.onBarcodeScanned).not.toBeNull());
    await act(async () => {
      scanner.onBarcodeScanned?.({ data: PAYLOAD });
      await Promise.resolve();
    });
    expect(await screen.findByTestId('scan-result')).toHaveTextContent(/Already used: seat 1A/);
    expect(scans).toBe(2);
  });

  it('explains why a code is not a valid ticket', async () => {
    mockApi({
      'GET /v1/operator/trips': () => json({ trips: [] }),
      'POST /v1/operator/tickets/scan': () =>
        json({ result: 'invalid', reason: 'bad_signature', ticket: null }),
    });
    await renderWithApp(
      <OperatorScanScreen />,
      await signedInSession({ roles: ['customer', 'operator_agent'] }),
    );
    await fireEvent.changeText(await screen.findByTestId('scan-manual'), PAYLOAD);
    await fireEvent.press(screen.getByTestId('scan-check'));
    expect(await screen.findByTestId('scan-result')).toHaveTextContent(
      `${m.mobile.cars.operator.results.invalid}${m.mobile.cars.operator.reasons.bad_signature}`,
    );
  });
});
