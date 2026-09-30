import * as AppIntegrity from '@expo/app-integrity';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { Platform } from 'react-native';

import { appConfig } from '../config';

import type { ApiClient } from './api';
import { SECURE_KEYS, secureStorage } from './secure-storage';

type Kind = 'integrity' | 'attestation' | 'assertion';

interface Evidence {
  kind: Kind;
  token: string;
  keyId: string | null;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url of ASCII text, without relying on `btoa` or Buffer. */
export function base64UrlAscii(text: string): string {
  let output = '';
  for (let index = 0; index < text.length; index += 3) {
    const [a, b, c] = [
      text.charCodeAt(index),
      text.charCodeAt(index + 1),
      text.charCodeAt(index + 2),
    ];
    const triple = (a << 16) | ((b || 0) << 8) | (c || 0);
    output += BASE64[(triple >> 18) & 63] ?? '';
    output += BASE64[(triple >> 12) & 63] ?? '';
    if (index + 1 < text.length) output += BASE64[(triple >> 6) & 63] ?? '';
    if (index + 2 < text.length) output += BASE64[triple & 63] ?? '';
  }
  return output;
}

let integrityPrepared: Promise<void> | null = null;

async function androidEvidence(challenge: string): Promise<Evidence | null> {
  if (!appConfig.playIntegrityProject) return null;
  integrityPrepared ??= AppIntegrity.prepareIntegrityTokenProviderAsync(
    appConfig.playIntegrityProject,
  ).catch((error: unknown) => {
    integrityPrepared = null;
    throw error;
  });
  await integrityPrepared;
  // Standard requests bind the verdict to a hash of the request; ours is the challenge.
  const requestHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, challenge);
  const token = await AppIntegrity.requestIntegrityCheckAsync(requestHash);
  return { kind: 'integrity', token, keyId: null };
}

async function iosEvidence(challenge: string): Promise<Evidence | null> {
  if (!AppIntegrity.isSupported) return null;
  let keyId = await secureStorage.get(SECURE_KEYS.attestKeyId);
  if (!keyId) {
    keyId = await AppIntegrity.generateKeyAsync();
    await secureStorage.set(SECURE_KEYS.attestKeyId, keyId);
  }
  // One attestation per key and install, then assertions (Apple's recommended flow).
  if ((await secureStorage.get(SECURE_KEYS.attestDone)) !== '1') {
    const token = await AppIntegrity.attestKeyAsync(keyId, challenge);
    await secureStorage.set(SECURE_KEYS.attestDone, '1');
    return { kind: 'attestation', token, keyId };
  }
  const token = await AppIntegrity.generateAssertionAsync(keyId, challenge);
  return { kind: 'assertion', token, keyId };
}

/**
 * `X-Suskii-Attestation` for a sensitive request (ADR-023): a fresh single-use challenge from the
 * API and a platform token bound to it. Development and e2e builds send `mock:<challenge>`.
 * Returns null when the device cannot attest; the API then decides (guest checkout fails closed).
 */
export async function attestationHeader(api: ApiClient): Promise<string | null> {
  try {
    const { data } = await api.POST('/v1/attestation/challenges');
    if (!data) return null;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const evidence: Evidence | null =
      appConfig.attestation === 'mock'
        ? {
            kind: platform === 'ios' ? 'assertion' : 'integrity',
            token: `mock:${data.challenge}`,
            keyId: null,
          }
        : platform === 'ios'
          ? await iosEvidence(data.challenge)
          : await androidEvidence(data.challenge);
    if (!evidence) return null;
    return base64UrlAscii(
      JSON.stringify({ v: 1, platform, challenge: data.challenge, ...evidence }),
    );
  } catch {
    return null;
  }
}
