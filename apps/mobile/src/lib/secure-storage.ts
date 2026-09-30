import * as SecureStore from 'expo-secure-store';

/**
 * Secrets on the device (ADR-020): auth tokens, guest booking tokens, the cache key and the App
 * Attest key id. Keychain items are readable only while the device is unlocked and never migrate
 * to another device; Android uses the Keystore.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const SECURE_KEYS = {
  accessToken: 'auth.access',
  refreshToken: 'auth.refresh',
  cacheKey: 'cache.key',
  attestKeyId: 'attest.key-id',
  attestDone: 'attest.attested',
} as const;

const bookingKey = (bookingId: string): string => `booking.${bookingId}`;

export const secureStorage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key, OPTIONS),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(key, OPTIONS),
  bookingToken: (bookingId: string): Promise<string | null> =>
    SecureStore.getItemAsync(bookingKey(bookingId), OPTIONS),
  saveBookingToken: (bookingId: string, token: string): Promise<void> =>
    SecureStore.setItemAsync(bookingKey(bookingId), token, OPTIONS),
  removeBookingToken: (bookingId: string): Promise<void> =>
    SecureStore.deleteItemAsync(bookingKey(bookingId), OPTIONS),
};
