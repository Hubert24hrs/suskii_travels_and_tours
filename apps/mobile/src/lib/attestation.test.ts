import * as AppIntegrity from '@expo/app-integrity';
import { waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { createHash } from 'node:crypto';
import { Platform } from 'react-native';

import { json, mockApi } from '../test/app';
import { appConfig } from '../config';

import { createBareApi } from './api';
import { attestationHeader, base64UrlAscii, noteAttestationResult } from './attestation';
import { SECURE_KEYS } from './secure-storage';

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

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const key of [
      SECURE_KEYS.attestKeyId,
      SECURE_KEYS.attestDone,
      SECURE_KEYS.attestPending,
    ]) {
      await SecureStore.deleteItemAsync(key);
    }
  });

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

  it('attests the App Attest key once the API accepts it, then sends assertions', async () => {
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

    await noteAttestationResult('valid');
    expect(decode(await attestationHeader(api))).toMatchObject({
      kind: 'assertion',
      token: 'assertion-object',
      keyId: 'key-1',
      challenge: 'challenge-2',
    });
    expect(AppIntegrity.generateKeyAsync).toHaveBeenCalledTimes(1);
    expect(AppIntegrity.generateAssertionAsync).toHaveBeenCalledWith('key-1', 'challenge-2');
  });

  it('replaces a key whose attestation the API never accepted, or rejected later', async () => {
    Object.assign(appConfig, { attestation: 'native' });
    challenges();
    jest
      .mocked(AppIntegrity.generateKeyAsync)
      .mockResolvedValueOnce('key-a')
      .mockResolvedValueOnce('key-b')
      .mockResolvedValueOnce('key-c');
    const api = createBareApi();

    expect(decode(await attestationHeader(api))).toMatchObject({
      kind: 'attestation',
      keyId: 'key-a',
    });
    // The answer never came (offline, or a 5xx without a verdict): Apple attests a key once.
    expect(decode(await attestationHeader(api))).toMatchObject({
      kind: 'attestation',
      keyId: 'key-b',
    });
    await noteAttestationResult('valid');
    expect(decode(await attestationHeader(api))).toMatchObject({
      kind: 'assertion',
      keyId: 'key-b',
    });

    // The API no longer knows the key: the next request attests a new one.
    await noteAttestationResult('invalid');
    expect(decode(await attestationHeader(api))).toMatchObject({
      kind: 'attestation',
      keyId: 'key-c',
    });
    // A verdict without anything pending changes nothing.
    await noteAttestationResult('missing');
    await noteAttestationResult(null);
    expect(await SecureStore.getItemAsync(SECURE_KEYS.attestPending)).toBe('key-c');
  });

  it('learns the verdict from any response to a request that carried the attestation', async () => {
    Object.assign(appConfig, { attestation: 'native' });
    challenges();
    await SecureStore.setItemAsync(SECURE_KEYS.attestKeyId, 'key-z');
    await SecureStore.setItemAsync(SECURE_KEYS.attestPending, 'key-z');
    mockApi({
      'POST /v1/auth/login': () =>
        new Response(JSON.stringify({ status: 'mfa_required' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Suskii-Attestation-Result': 'valid' },
        }),
    });
    await createBareApi().POST('/v1/auth/login', {
      params: { header: { 'X-Suskii-Attestation': 'evidence' } },
      body: { email: 'a@example.com', password: 'a long passphrase', transport: 'token' },
    });
    await waitFor(async () =>
      expect(await SecureStore.getItemAsync(SECURE_KEYS.attestDone)).toBe('1'),
    );
    expect(await SecureStore.getItemAsync(SECURE_KEYS.attestPending)).toBeNull();
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
