import { getMessages } from '@suskii/i18n';
import { toFlightSearchRequest, parseFlightSearchParams } from '@suskii/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { json, mockApi, renderWithApp, signedInSession } from '../../test/app';

import { WatchRoute } from './watch-route';

const m = getMessages('en-NG');
const { form } = parseFlightSearchParams({
  trip: 'one_way',
  from: 'LOS',
  to: 'DXB',
  depart: '2026-12-10',
  adults: '1',
});
const request = toFlightSearchRequest(form!);

describe('WatchRoute', () => {
  it('creates a price alert for the first flight of the search', async () => {
    const saved: unknown[] = [];
    mockApi({
      'POST /v1/me/price-alerts': async (call) => {
        saved.push(await call.json());
        return json({}, 201);
      },
    });
    await renderWithApp(<WatchRoute request={request} currency="NGN" />, await signedInSession());

    await fireEvent.press(screen.getByTestId('watch-route'));

    expect(await screen.findByText(m.alerts.watching)).toBeOnTheScreen();
    expect(screen.queryByTestId('watch-route')).toBeNull();
    expect(saved).toEqual([
      {
        origin: 'LOS',
        destination: 'DXB',
        departureDate: '2026-12-10',
        cabinClass: 'economy',
        currency: 'NGN',
      },
    ]);
  });

  it('explains the alert limit', async () => {
    mockApi({
      'POST /v1/me/price-alerts': () =>
        json({ type: 'urn:suskii:problem:price-alert-limit', title: 'Limit', status: 409 }, 409),
    });
    await renderWithApp(<WatchRoute request={request} currency="NGN" />, await signedInSession());

    await fireEvent.press(screen.getByTestId('watch-route'));
    expect(await screen.findByText(m.alerts.limit)).toBeOnTheScreen();
  });

  it('offers sign-in to visitors', async () => {
    mockApi({});
    await renderWithApp(<WatchRoute request={request} currency="NGN" />);
    await fireEvent.press(screen.getByTestId('watch-route-sign-in'));
    expect(router.push).toHaveBeenCalledWith('/sign-in');
  });
});
