import { createHash } from 'node:crypto';

import * as AppleAuthentication from 'expo-apple-authentication';
import { openAuthSessionAsync, type WebBrowserAuthSessionResult } from 'expo-web-browser';
import { Platform } from 'react-native';

import { json, mockApi } from '../test/app';

import { createBareApi } from './api';
import { APP_RETURN_URL, providerToken } from './social-sign-in';

const NONCE = 'n'.repeat(43);

/** The website's hand-back to the app, as the callback page builds it. */
function handBack(values: Record<string, string>) {
  return { type: 'success' as const, url: `${APP_RETURN_URL}#${new URLSearchParams(values)}` };
}

describe('Google and Apple through the website', () => {
  afterEach(() => {
    Platform.OS = 'ios';
  });

  it('binds the nonce to a secret only the app holds and sends it with the token', async () => {
    const { calls } = mockApi({
      'POST /v1/auth/social/nonce': () => json({ nonce: NONCE, expiresAt: '2026-10-27T12:10:00Z' }),
    });
    jest.mocked(openAuthSessionAsync).mockImplementation((url) => {
      const state = new URL(url).searchParams.get('state') ?? '';
      return Promise.resolve(
        handBack({ provider: 'google', idToken: 'google.id.token', nonce: NONCE, state }),
      );
    });

    const token = await providerToken(createBareApi(), 'google');

    expect(token).toMatchObject({ status: 'token', idToken: 'google.id.token', nonce: NONCE });
    if (token.status !== 'token') throw new Error('no token');
    const { binding } = (await calls[0]?.json()) as { binding: string };
    expect(binding).toBe(
      createHash('sha256')
        .update(token.bindingSecret ?? '')
        .digest('hex'),
    );
    const [opened, returnUrl] = jest.mocked(openAuthSessionAsync).mock.calls[0] ?? [];
    expect(returnUrl).toBe(APP_RETURN_URL);
    expect(opened).toMatch(
      /^http:\/\/localhost:3000\/sign-in\/app\?provider=google&nonce=n+&state=/,
    );
    // The secret never leaves for the browser.
    expect(opened).not.toContain(token.bindingSecret);
  });

  it('refuses a hand-back for another sign-in, and treats a closed browser as cancelled', async () => {
    mockApi({
      'POST /v1/auth/social/nonce': () => json({ nonce: NONCE, expiresAt: '2026-10-27T12:10:00Z' }),
    });
    jest
      .mocked(openAuthSessionAsync)
      .mockResolvedValueOnce(
        handBack({ provider: 'google', idToken: 'x', nonce: NONCE, state: 'someone-elses-state' }),
      );
    await expect(providerToken(createBareApi(), 'google')).resolves.toEqual({ status: 'error' });

    jest
      .mocked(openAuthSessionAsync)
      .mockResolvedValueOnce({ type: 'cancel' } as WebBrowserAuthSessionResult);
    await expect(providerToken(createBareApi(), 'google')).resolves.toEqual({
      status: 'cancelled',
    });
  });

  it('uses the system Apple sheet on an iPhone, with the hashed nonce', async () => {
    mockApi({
      'POST /v1/auth/social/nonce': () => json({ nonce: NONCE, expiresAt: '2026-10-27T12:10:00Z' }),
    });
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValueOnce(true);
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({
      identityToken: 'apple.id.token',
      fullName: { givenName: 'Ada', familyName: 'Okafor' },
    } as AppleAuthentication.AppleAuthenticationCredential);

    await expect(providerToken(createBareApi(), 'apple')).resolves.toEqual({
      status: 'token',
      idToken: 'apple.id.token',
      nonce: NONCE,
      displayName: 'Ada Okafor',
    });
    expect(jest.mocked(AppleAuthentication.signInAsync).mock.calls[0]?.[0]?.nonce).toBe(
      createHash('sha256').update(NONCE).digest('hex'),
    );
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
