import type * as SecureStoreModule from 'expo-secure-store';

import type * as CacheModule from './cache';

describe('openSecureCache', () => {
  it('creates one key when two callers open the cache on a first launch', async () => {
    await jest.isolateModulesAsync(async () => {
      // A fresh module registry: no cache opened and no key in the secure store yet.
      const SecureStore = jest.requireMock<typeof SecureStoreModule>('expo-secure-store');
      const { openSecureCache } = jest.requireActual<typeof CacheModule>('./cache');

      // The root layout and a cold-start deep link both open it.
      const [first, second] = await Promise.all([openSecureCache(), openSecureCache()]);

      expect(first).toBe(second);
      const keyWrites = jest
        .mocked(SecureStore.setItemAsync)
        .mock.calls.filter(([key]) => key === 'cache.key');
      expect(keyWrites).toHaveLength(1);
      expect(await openSecureCache()).toBe(first);
    });
  });
});
