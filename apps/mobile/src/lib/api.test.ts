import { json, mockApi } from '../test/app';

import { createAppApi, createBareApi, isNetworkError, problemSlug, type TokenSource } from './api';

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

describe('createBareApi', () => {
  it('never sends credentials', async () => {
    const { calls } = mockApi({ 'POST /v1/attestation/challenges': () => json({}, 201) });
    await createBareApi().POST('/v1/attestation/challenges');
    expect(calls[0]?.headers.get('Authorization')).toBeNull();
    expect(calls[0]?.headers.get('X-Suskii-Client')).toMatch(/^mobile-/);
  });
});

describe('error helpers', () => {
  it('reads problem slugs and tells network failures from API answers', () => {
    expect(problemSlug({ type: 'urn:suskii:problem:price-changed' })).toBe('price-changed');
    expect(problemSlug({ title: 'x' })).toBeNull();
    expect(problemSlug(null)).toBeNull();
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new Error('500'))).toBe(false);
  });
});
