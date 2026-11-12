import { describe, expect, it, vi } from 'vitest';

import { createApiClient, isProblemDetails, type Schemas } from './index';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createApiClient', () => {
  it('calls typed endpoints and returns typed data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'ok' }));
    const client = createApiClient({ baseUrl: 'https://api.test', fetch: fetchMock });

    const { data, error } = await client.GET('/health');

    const health: Schemas['HealthStatus'] | undefined = data;
    expect(health).toEqual({ status: 'ok' });
    expect(error).toBeUndefined();
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://api.test/health');
  });

  it('adds the bearer token on every request and the CSRF token on unsafe methods only', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse({ status: 'ok' })));
    const client = createApiClient({
      baseUrl: 'https://api.test',
      fetch: fetchMock,
      getAccessToken: () => Promise.resolve('access-123'),
      getCsrfToken: () => 'csrf-456',
    });

    await client.GET('/health');
    const getRequest = fetchMock.mock.calls[0]?.[0] as Request;
    expect(getRequest.headers.get('Authorization')).toBe('Bearer access-123');
    expect(getRequest.headers.get('X-CSRF-Token')).toBeNull();
  });

  it('recognises problem details', () => {
    expect(
      isProblemDetails({ type: 'urn:suskii:problem:not-found', title: 'Not found', status: 404 }),
    ).toBe(true);
    expect(isProblemDetails({ message: 'nope' })).toBe(false);
  });
});
