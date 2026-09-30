import type { Schemas } from '@suskii/api-client';
import * as SecureStore from 'expo-secure-store';

import { openSecureCache } from './cache';
import { SECURE_KEYS } from './secure-storage';
import { SessionStore, type RefreshOutcome } from './session';

const user: Schemas['AuthUser'] = {
  id: '0192d3a0-7c1e-7b2a-9f00-1234567890ab',
  email: 'ada@example.com',
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  displayName: 'Ada',
  roles: ['customer'],
  mfaEnabled: false,
  hasPassword: true,
};

const session = (access: string, refresh: string): Schemas['AuthSession'] => ({
  status: 'authenticated',
  user,
  sessionId: '0192d3a0-7c1e-7b2a-9f00-0000000000aa',
  accessTokenExpiresAt: '2026-01-01T00:15:00Z',
  refreshTokenExpiresAt: '2026-01-31T00:00:00Z',
  accessToken: access,
  refreshToken: refresh,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('SessionStore', () => {
  beforeAll(async () => {
    await openSecureCache();
  });

  it('keeps tokens in the secure store and restores the profile on the next launch', async () => {
    const first = new SessionStore(() => Promise.resolve('unavailable'));
    await first.save(session('access-1', 'refresh-1'));
    expect(await SecureStore.getItemAsync(SECURE_KEYS.refreshToken)).toBe('refresh-1');

    const next = new SessionStore(() => Promise.resolve('unavailable'));
    await next.load();
    expect(next.signedIn).toBe(true);
    expect(next.accessToken()).toBe('access-1');
    expect(next.user?.email).toBe('ada@example.com');
  });

  it('rotates the refresh token once for parallel callers', async () => {
    const answer = deferred<RefreshOutcome>();
    const refreshCall = jest.fn(() => answer.promise);
    const store = new SessionStore(refreshCall);
    await store.save(session('access-1', 'refresh-1'));

    const calls = [store.refresh(), store.refresh(), store.refresh()];
    answer.resolve(session('access-2', 'refresh-2'));

    expect(await Promise.all(calls)).toEqual(['access-2', 'access-2', 'access-2']);
    expect(refreshCall).toHaveBeenCalledTimes(1);
    expect(refreshCall).toHaveBeenCalledWith('refresh-1');
    expect(store.refreshToken()).toBe('refresh-2');

    // A later refresh starts a new rotation with the new token.
    refreshCall.mockResolvedValueOnce(session('access-3', 'refresh-3'));
    expect(await store.refresh()).toBe('access-3');
    expect(refreshCall).toHaveBeenLastCalledWith('refresh-2');
  });

  it('signs out when the refresh token is rejected', async () => {
    const store = new SessionStore(() => Promise.resolve('invalid'));
    await store.save(session('access-1', 'refresh-1'));
    const listener = jest.fn();
    store.subscribe(listener);

    expect(await store.refresh()).toBeUndefined();
    expect(store.signedIn).toBe(false);
    expect(store.user).toBeNull();
    expect(await SecureStore.getItemAsync(SECURE_KEYS.refreshToken)).toBeNull();
    expect(listener).toHaveBeenCalled();
  });

  it('stays signed in while offline', async () => {
    const store = new SessionStore(() => Promise.resolve('unavailable'));
    await store.save(session('access-1', 'refresh-1'));

    expect(await store.refresh()).toBeUndefined();
    expect(store.signedIn).toBe(true);
    expect(store.refreshToken()).toBe('refresh-1');
  });

  it('refuses sessions delivered as cookies', async () => {
    const store = new SessionStore(() => Promise.resolve('unavailable'));
    const { accessToken: _access, refreshToken: _refresh, ...cookieSession } = session('a', 'r');
    await expect(store.save(cookieSession)).rejects.toThrow('token transport expected');
  });
});
