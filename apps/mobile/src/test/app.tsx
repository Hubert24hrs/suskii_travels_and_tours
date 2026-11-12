import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { openSecureCache } from '../lib/cache';
import { SessionStore, type AuthUser, type RefreshOutcome } from '../lib/session';
import { AppProvider } from '../providers/app-provider';

type Handler = (request: Request) => Response | Promise<Response>;

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

/** What fetch throws without a connection (React Native rejects with a TypeError too). */
export const offline: Handler = () => {
  throw new TypeError('Network request failed');
};

/**
 * Fakes the API for one test: `routes['GET /v1/deals']` answers that method and path. Unknown
 * calls reject, so a screen calling something unexpected fails its assertions.
 */
export function mockApi(routes: Record<string, Handler>): { calls: Request[] } {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    const handler = routes[`${request.method} ${new URL(request.url).pathname}`];
    if (!handler) {
      return Promise.reject(new Error(`Unexpected ${request.method} ${request.url}`));
    }
    try {
      return Promise.resolve(handler(request));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return { calls };
}

/** A signed-out session whose refresh never answers. */
export const guestSession = (
  refresh: (token: string) => Promise<RefreshOutcome> = () => Promise.resolve('unavailable'),
): SessionStore => new SessionStore(refresh);

export const USER_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c001';

/** A session signed in as a customer (tokens in the mocked secure store). */
export async function signedInSession(user: Partial<AuthUser> = {}): Promise<SessionStore> {
  await openSecureCache();
  const session = guestSession();
  await session.save({
    status: 'authenticated',
    sessionId: '0192d3a0-7c1e-7b2a-9f00-00000000c002',
    accessTokenExpiresAt: '2026-10-05T10:15:00.000Z',
    refreshTokenExpiresAt: '2026-11-04T10:00:00.000Z',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: {
      id: USER_ID,
      email: 'ada@example.com',
      emailVerified: true,
      phone: '+2348012345678',
      phoneVerified: true,
      displayName: 'Ada Okafor',
      roles: ['customer'],
      mfaEnabled: false,
      hasPassword: true,
      ...user,
    },
  });
  return session;
}

/** Renders a screen inside the app's providers, with the encrypted cache open. */
export async function renderWithApp(
  ui: ReactElement,
  session: SessionStore = guestSession(),
): Promise<QueryClient> {
  await openSecureCache();
  // No retries, and no garbage-collection timers left running after the test (TanStack's advice).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <AppProvider session={session} queryClient={queryClient}>
        {ui}
      </AppProvider>
    </SafeAreaProvider>,
  );
  return queryClient;
}
