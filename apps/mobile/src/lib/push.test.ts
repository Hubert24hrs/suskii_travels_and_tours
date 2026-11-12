import { json, mockApi, offline } from '../test/app';

import { createBareApi } from './api';
import { followAccount, followBooking } from './push';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', easProjectId: 'eas-project' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[abc]' })),
}));

const BOOKING_ID = '0192d3a0-7c1e-7b2a-9f00-1234567890ab';

describe('push follow helpers', () => {
  it('register the device token with the API', async () => {
    const { calls } = mockApi({
      'PUT /v1/me/push-token': () => new Response(null, { status: 204 }),
      [`PUT /v1/bookings/${BOOKING_ID}/push-token`]: () => json({}, 200),
    });
    expect(await followAccount(createBareApi(), true)).toBe(true);
    expect(await followBooking(createBareApi(), BOOKING_ID, {}, true)).toBe(true);
    expect(await calls[0]?.json()).toEqual({ token: 'ExponentPushToken[abc]', platform: 'ios' });
  });

  it('answer false without a connection instead of throwing', async () => {
    mockApi({
      'PUT /v1/me/push-token': offline,
      [`PUT /v1/bookings/${BOOKING_ID}/push-token`]: offline,
    });
    await expect(followAccount(createBareApi(), true)).resolves.toBe(false);
    await expect(followBooking(createBareApi(), BOOKING_ID, {}, true)).resolves.toBe(false);
  });
});
