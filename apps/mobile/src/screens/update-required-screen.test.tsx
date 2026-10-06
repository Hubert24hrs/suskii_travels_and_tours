import { fireEvent, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { appUpdate, storeUrl } from '../lib/app-update';
import { createAppApi } from '../lib/api';
import { json, mockApi, renderWithApp } from '../test/app';

import { UpdateRequiredScreen } from './update-required-screen';

jest.mock('../config', () => ({
  appConfig: {
    apiBaseUrl: 'http://api.test',
    androidPackage: 'com.suskii.travels',
    iosAppStoreUrl: 'https://apps.apple.com/app/id000000000',
  },
  CLIENT_ID: 'mobile-ios/0.1.0',
}));

describe('retired app versions (MASVS-CODE-2)', () => {
  beforeEach(() => appUpdate.reset());

  it('switches to the update screen when the API answers 426', async () => {
    mockApi({
      'GET /v1/me': () =>
        json(
          { type: 'urn:suskii:problem:app-update-required', status: 426, minVersion: '9.0.0' },
          426,
        ),
    });
    const listener = jest.fn();
    const unsubscribe = appUpdate.subscribe(listener);
    const api = createAppApi(
      { accessToken: () => 'access', refresh: () => Promise.resolve(undefined) },
      () => 'en-NG',
    );

    await api.GET('/v1/me');

    expect(appUpdate.required).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('links to the store listing for each platform', () => {
    expect(storeUrl('android')).toBe(
      'https://play.google.com/store/apps/details?id=com.suskii.travels',
    );
    expect(storeUrl('ios')).toBe('https://apps.apple.com/app/id000000000');
    expect(storeUrl('web')).toBeNull();
  });

  it('opens the store from the update screen', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderWithApp(<UpdateRequiredScreen />);

    expect(screen.getByRole('header', { name: 'Update Suskii Travels' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Update the app' }));

    expect(open).toHaveBeenCalledWith(storeUrl());
  });
});
