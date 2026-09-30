import * as AppIntegrity from '@expo/app-integrity';
import { createHash } from 'node:crypto';
import { Platform } from 'react-native';

import { json, mockApi } from '../test/app';
import { appConfig } from '../config';

import { createBareApi } from './api';
import { attestationHeader, base64UrlAscii } from './attestation';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-ios/0.1.0',
}));
jest.mock('@expo/app-integrity', () => ({
  isSupported: true,
  generateKeyAsync: jest.fn(() => Promise.resolve('key-1')),
  attestKeyAsync: jest.fn(() => Promise.resolve('attestation-object')),
  generateAssertionAsync: jest.fn(() => Promise.resolve('assertion-object')),
  prepareIntegrityTokenProviderAsync: jest.fn(() => Promise.resolve()),
  requestIntegrityCheckAsync: jest.fn(() => Promise.resolve('integrity-token')),
}));

const decode = (header: string | null): unknown =>
  JSON.parse(Buffer.from(header ?? '', 'base64url').toString('utf8'));

const challenges = (): void => {
  let count = 0;
  mockApi({
    'POST /v1/attestation/challenges': () => {
      count += 1;
      return json({ challenge: `challenge-${count}`, expiresAt: '2026-01-01T00:00:00Z' }, 201);
    },
  });
};

describe('base64UrlAscii', () => {
  it.each(['', 'a', 'ab', 'abc', 'abcd', '{"v":1,"token":"mock:x_y-z"}'])(
    'matches Node for %j',
    (text) => {
      expect(base64UrlAscii(text)).toBe(Buffer.from(text).toString('base64url'));
    },
  );
});

describe('attestationHeader', () => {
  let platform: jest.ReplaceProperty<typeof Platform.OS> | undefined;
  const runOn = (os: typeof Platform.OS): void => {
    platform = jest.replaceProperty(Platform, 'OS', os);
  };

  afterEach(() => {
    platform?.restore();
    Object.assign(appConfig, { attestation: 'mock', playIntegrityProject: '' });
  });

  it('sends a mock token bound to a fresh challenge in development builds', async () => {
    challenges();
    const header = await attestationHeader(createBareApi());
    expect(decode(header)).toEqual({
      v: 1,
      platform: 'ios',
      challenge: 'challenge-1',
      kind: 'assertion',
      token: 'mock:challenge-1',
      keyId: null,
    });
  });

  it('attests the App Attest key once, then sends assertions', async () => {
    Object.assign(appConfig, { attestation: 'native' });
    challenges();
    const api = createBareApi();

    expect(decode(await attestationHeader(api))).toMatchObject({
      kind: 'attestation',
      token: 'attestation-object',
      keyId: 'key-1',
      challenge: 'challenge-1',
    });
    expect(AppIntegrity.attestKeyAsync).toHaveBeenCalledWith('key-1', 'challenge-1');

    expect(decode(await attestationHeader(api))).toMatchObject({
      kind: 'assertion',
      token: 'assertion-object',
      keyId: 'key-1',
      challenge: 'challenge-2',
    });
    expect(AppIntegrity.generateKeyAsync).toHaveBeenCalledTimes(1);
    expect(AppIntegrity.generateAssertionAsync).toHaveBeenCalledWith('key-1', 'challenge-2');
  });

  it('binds a Play Integrity verdict to the challenge hash on Android', async () => {
    runOn('android');
    Object.assign(appConfig, { attestation: 'native', playIntegrityProject: '123456789' });
    challenges();

    const header = await attestationHeader(createBareApi());

    expect(decode(header)).toMatchObject({
      platform: 'android',
      kind: 'integrity',
      token: 'integrity-token',
      keyId: null,
    });
    expect(AppIntegrity.prepareIntegrityTokenProviderAsync).toHaveBeenCalledWith('123456789');
    expect(AppIntegrity.requestIntegrityCheckAsync).toHaveBeenCalledWith(
      createHash('sha256').update('challenge-1').digest('hex'),
    );
  });

  it('returns null when the device cannot attest or the API is unreachable', async () => {
    runOn('android');
    Object.assign(appConfig, { attestation: 'native', playIntegrityProject: '' });
    challenges();
    expect(await attestationHeader(createBareApi())).toBeNull();

    mockApi({
      'POST /v1/attestation/challenges': () => {
        throw new TypeError('Network request failed');
      },
    });
    expect(await attestationHeader(createBareApi())).toBeNull();
  });
});
