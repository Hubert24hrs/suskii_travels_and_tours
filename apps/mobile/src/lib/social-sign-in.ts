import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { openAuthSessionAsync } from 'expo-web-browser';
import { Platform } from 'react-native';

import { appConfig } from '../config';

import type { ApiClient } from './api';

export type SocialProvider = 'google' | 'apple';

/** Where the website hands a finished sign-in back (ADR-067); deep links leave it alone. */
export const APP_RETURN_URL = 'suskii://auth/social';

export type ProviderToken =
  | {
      status: 'token';
      idToken: string;
      nonce: string;
      bindingSecret?: string;
      displayName?: string;
    }
  | { status: 'cancelled' }
  | { status: 'error' };

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The fragment's values (React Native's URLSearchParams is partial, so parsed by hand). */
function fragmentValues(url: string): Record<string, string> {
  const fragment = url.split('#')[1] ?? '';
  const values: Record<string, string> = {};
  for (const pair of fragment.split('&')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    try {
      values[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(pair.slice(index + 1));
    } catch {
      // A malformed pair is ignored.
    }
  }
  return values;
}

async function nonce(api: ApiClient, binding?: string): Promise<string | null> {
  const { data } = await api.POST('/v1/auth/social/nonce', {
    body: binding ? { binding } : {},
  });
  return data?.nonce ?? null;
}

/** Sign in with Apple on an iPhone: the system sheet, no browser. */
async function appleNative(api: ApiClient): Promise<ProviderToken> {
  const raw = await nonce(api);
  if (!raw) return { status: 'error' };
  try {
    // Apple puts the nonce's SHA-256 (hex) in the token; the API accepts it (ADR-007).
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw),
    });
    if (!credential.identityToken) return { status: 'error' };
    const name = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ');
    return {
      status: 'token',
      idToken: credential.identityToken,
      nonce: raw,
      ...(name ? { displayName: name } : {}),
    };
  } catch (error) {
    return (error as { code?: string }).code === 'ERR_REQUEST_CANCELED'
      ? { status: 'cancelled' }
      : { status: 'error' };
  }
}

/**
 * Google everywhere, and Apple on Android: the website does the provider step in the system
 * browser and hands the ID token back to APP_RETURN_URL. The nonce is bound to a secret that
 * never leaves the app, so a token another app catches on the way back is useless.
 */
async function throughWebsite(api: ApiClient, provider: SocialProvider): Promise<ProviderToken> {
  const secret = base64Url(Crypto.getRandomBytes(32));
  const binding = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, secret);
  const issued = await nonce(api, binding);
  if (!issued) return { status: 'error' };
  const state = base64Url(Crypto.getRandomBytes(24));
  const url =
    `${appConfig.webBaseUrl}/sign-in/app?provider=${provider}` +
    `&nonce=${encodeURIComponent(issued)}&state=${encodeURIComponent(state)}`;
  const result = await openAuthSessionAsync(url, APP_RETURN_URL);
  if (result.type !== 'success') return { status: 'cancelled' };
  const values = fragmentValues(result.url);
  if (values.state !== state || values.provider !== provider || values.nonce !== issued) {
    return { status: 'error' };
  }
  return values.idToken
    ? { status: 'token', idToken: values.idToken, nonce: issued, bindingSecret: secret }
    : { status: 'error' };
}

/** An ID token from Google or Apple for this device (ADR-067). */
export async function providerToken(
  api: ApiClient,
  provider: SocialProvider,
): Promise<ProviderToken> {
  try {
    if (
      provider === 'apple' &&
      Platform.OS === 'ios' &&
      (await AppleAuthentication.isAvailableAsync())
    ) {
      return await appleNative(api);
    }
    return await throughWebsite(api, provider);
  } catch {
    return { status: 'error' };
  }
}

/** The test server's stand-in for the provider: an ID token for the email the tester typed. */
export async function mockProviderToken(
  api: ApiClient,
  provider: SocialProvider,
  email: string,
  name: string,
): Promise<ProviderToken> {
  try {
    const issued = await nonce(api);
    if (!issued) return { status: 'error' };
    const { data } = await api.POST('/v1/auth/social/mock-token', {
      body: { provider, email, nonce: issued, ...(name ? { name } : {}) },
    });
    return data ? { status: 'token', idToken: data.idToken, nonce: issued } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}
