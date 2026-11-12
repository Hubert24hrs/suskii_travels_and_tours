import { getRandomBytes } from 'expo-crypto';
import { createMMKV, type MMKV } from 'react-native-mmkv';

import { SECURE_KEYS, secureStorage } from './secure-storage';

/**
 * Local storage (ADR-020). `secureCache` holds personal data kept for offline use (trips, booking
 * details, the documents index), encrypted with AES-256 and a random key from the secure store.
 * `preferences` holds settings only (currency, recent searches) and is not encrypted.
 */
let secure: MMKV | null = null;
let opening: Promise<MMKV> | null = null;

export const preferences: MMKV = createMMKV({ id: 'suskii.preferences' });

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 32 characters from 32 random bytes (AES-256 takes a key of up to 32 bytes). */
function newKey(): string {
  return Array.from(getRandomBytes(32), (byte) => KEY_ALPHABET[byte % 64]).join('');
}

/**
 * Opens (once) the encrypted cache, creating its key on first launch. Single flight: two callers
 * on a first launch would otherwise each create a key, and the cache would be opened with one
 * while the secure store keeps the other, so the next launch could not read it.
 */
export function openSecureCache(): Promise<MMKV> {
  if (secure) return Promise.resolve(secure);
  opening ??= open().finally(() => {
    opening = null;
  });
  return opening;
}

async function open(): Promise<MMKV> {
  let key = await secureStorage.get(SECURE_KEYS.cacheKey);
  if (!key) {
    key = newKey();
    await secureStorage.set(SECURE_KEYS.cacheKey, key);
  }
  secure = createMMKV({ id: 'suskii.secure', encryptionKey: key, encryptionType: 'AES-256' });
  return secure;
}

export function secureCache(): MMKV {
  if (!secure) throw new Error('openSecureCache() has not finished');
  return secure;
}

export function readJson<T>(store: MMKV, key: string): T | null {
  const raw = store.getString(key);
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    store.remove(key);
    return null;
  }
}

export function writeJson(store: MMKV, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}
