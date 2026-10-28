import { json, mockApi } from '../test/app';

import {
  createAppApi,
  createBareApi,
  isNetworkError,
  NetworkError,
  problemSlug,
  READ_TIMEOUT_MS,
  type TokenSource,
} from './api';

function tokens(access: string | undefined, fresh: string | undefined) {
  const refresh = jest.fn(() => Promise.resolve(fresh));
  const source: TokenSource = { accessToken: () => access, refresh };
  return { source, refresh };
}

const me = { id: '0192d3a0-7c1e-7b2a-9f00-1234567890ab' };

describe('createAppApi', () => {
  it('sends the bearer token, sales channel and language', async () => {
    const { calls } = mockApi({ 'GET /v1/me': () => json(me) });
    const api = createAppApi(tokens('access-1', undefined).source, () => 'en-GB');

    await api.GET('/v1/me');

    const [request] = calls;
    expect(request?.headers.get('Authorization')).toBe('Bearer access-1');
    expect(request?.headers.get('X-Suskii-Client')).toMatch(/^mobile-(ios|android)\/0\.1\.0$/);
    expect(request?.headers.get('Accept-Language')).toBe('en-GB');
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    const seen: (string | null)[] = [];
    mockApi({
      'GET /v1/me': (request) => {
        seen.push(request.headers.get('Authorization'));
        return seen.length === 1
          ? json({ type: 'urn:suskii:problem:unauthenticated', status: 401 }, 401)
          : json(me);
      },
    });
    const { source, refresh } = tokens('stale', 'fresh');
    const { data } = await createAppApi(source, () => 'en-NG').GET('/v1/me');

    expect(data).toEqual(me);
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('returns the 401 when the session cannot be refreshed', async () => {
    mockApi({
      'GET /v1/me': () => json({ type: 'urn:suskii:problem:unauthenticated', status: 401 }, 401),
    });
    const { response } = await createAppApi(tokens('stale', undefined).source, () => 'en-NG').GET(
      '/v1/me',
    );
    expect(response.status).toBe(401);
  });

  it('does not try to refresh requests sent without a token', async () => {
    const { calls } = mockApi({
      'GET /v1/me': () => json({ type: 'urn:suskii:problem:unauthenticated', status: 401 }, 401),
    });
    const { source, refresh } = tokens(undefined, 'fresh');
    await createAppApi(source, () => 'en-NG').GET('/v1/me');
    expect(refresh).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});

describe("the platform's own response class", () => {
  /** Expo's fetch answers with a FetchResponse that is not an instance of the global Response. */
  const foreignFetch = (body: unknown, status = 200) =>
    jest.fn(() => {
      const real = new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
      return Promise.resolve(
        Object.setPrototypeOf(
          {
            ok: real.ok,
            status: real.status,
            headers: real.headers,
            json: () => real.json(),
            text: () => real.text(),
            clone: () => real.clone(),
          },
          null,
        ) as Response,
      );
    });

  it('reads answers from a fetch whose responses are not the global Response', async () => {
    const fetch = foreignFetch(me);
    const app = createAppApi(tokens('access-1', undefined).source, () => 'en-NG', fetch);
    expect((await app.GET('/v1/me')).data).toEqual(me);
    expect((await createBareApi(fetch).GET('/v1/me')).data).toEqual(me);
  });
});

describe('createBareApi', () => {
  it('never sends credentials', async () => {
    const { calls } = mockApi({ 'POST /v1/attestation/challenges': () => json({}, 201) });
    await createBareApi().POST('/v1/attestation/challenges');
    expect(calls[0]?.headers.get('Authorization')).toBeNull();
    expect(calls[0]?.headers.get('X-Suskii-Client')).toMatch(/^mobile-/);
  });
});

describe('network failures', () => {
  it('reports any transport failure as a network error, whatever the platform throws', async () => {
    const refused = jest.fn(() => Promise.reject(new Error('java.net.ConnectException: refused')));
    const api = createAppApi(tokens(undefined, undefined).source, () => 'en-NG', refused);
    const failure = await api.GET('/v1/me').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(NetworkError);
    expect(isNetworkError(failure)).toBe(true);

    const bare = await createBareApi(refused)
      .POST('/v1/attestation/challenges')
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isNetworkError(bare)).toBe(true);
  });

  it('keeps aborted requests as aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborting = jest.fn(() => Promise.reject(new DOMException('Aborted', 'AbortError')));
    const api = createAppApi(tokens(undefined, undefined).source, () => 'en-NG', aborting);
    const failure = await api.GET('/v1/me', { signal: controller.signal }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isNetworkError(failure)).toBe(false);
  });
});

describe('request timeouts', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /** A platform fetch that never answers, as on a network that drops packets. */
  const silent = () =>
    jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          // Like fetch: a signal aborted before the call rejects at once.
          if (init?.signal?.aborted) abort();
          init?.signal?.addEventListener('abort', abort);
        }),
    );

  it('gives up on a read that never answers and reports it as no network', async () => {
    jest.useFakeTimers();
    const api = createAppApi(tokens(undefined, undefined).source, () => 'en-NG', silent());
    const failure = api.GET('/v1/me').then(
      () => null,
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    // Screens read this as offline and show what the phone saved.
    expect(isNetworkError(await failure)).toBe(true);
  });

  it('lets a write take as long as it needs', async () => {
    jest.useFakeTimers();
    const platform = silent();
    const api = createAppApi(tokens(undefined, undefined).source, () => 'en-NG', platform);
    let settled = false;
    void api.POST('/v1/attestation/challenges').finally(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(READ_TIMEOUT_MS * 10);
    expect(settled).toBe(false);
    expect(platform.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });

  it("keeps the caller's own abort an abort, not a network error", async () => {
    const controller = new AbortController();
    const api = createAppApi(tokens(undefined, undefined).source, () => 'en-NG', silent());
    const failure = api.GET('/v1/me', { signal: controller.signal }).then(
      () => null,
      (error: unknown) => error,
    );
    controller.abort();
    const error = await failure;
    expect(isNetworkError(error)).toBe(false);
    expect((error as Error).name).toBe('AbortError');
  });
});

describe('error helpers', () => {
  it('reads problem slugs and tells network failures from API answers', () => {
    expect(problemSlug({ type: 'urn:suskii:problem:price-changed' })).toBe('price-changed');
    expect(problemSlug({ title: 'x' })).toBeNull();
    expect(problemSlug(null)).toBeNull();
    expect(isNetworkError(new NetworkError(new Error('refused')))).toBe(true);
    expect(isNetworkError(new Error('500'))).toBe(false);
    // A bug (reading a property of undefined) is not "offline".
    expect(
      isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')")),
    ).toBe(false);
  });
});
