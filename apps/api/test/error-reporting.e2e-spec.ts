import { ContentService } from '../src/content/content.service';
import { supplierUnavailable } from '../src/search/search.errors';
import { ErrorReporter } from '../src/telemetry/error-reporter';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * ADR-046: an unexpected failure is reported once with the request id and route template; the
 * client sees a generic 500. Client errors and deliberate problem responses are not reported.
 */
describe('error reporting (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    await resetState(ctx);
  });
  afterAll(async () => {
    await resetState(ctx);
    await ctx.close();
  });
  afterEach(() => jest.restoreAllMocks());

  it('reports an unexpected error with ids and the route template only', async () => {
    const capture = jest.spyOn(ctx.app.get(ErrorReporter), 'capture');
    const boom = new Error('lookup failed for chioma@example.com');
    jest.spyOn(ctx.app.get(ContentService), 'home').mockRejectedValueOnce(boom);

    const response = await ctx.http().get('/v1/content/home?locale=en-NG').expect(500);
    expect(response.body).toMatchObject({ type: 'urn:suskii:problem:internal-server-error' });
    expect(JSON.stringify(response.body)).not.toContain('chioma');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(boom, {
      requestId: response.body.requestId,
      route: '/v1/content/home',
      method: 'GET',
      status: 500,
    });
  });

  it('does not report client errors or deliberate problems', async () => {
    const capture = jest.spyOn(ctx.app.get(ErrorReporter), 'capture');
    await ctx.http().get('/v1/no-such-route').expect(404);
    await ctx.http().post('/v1/telemetry/web-vitals').send({}).expect(400);
    jest.spyOn(ctx.app.get(ContentService), 'home').mockRejectedValueOnce(supplierUnavailable());
    await ctx.http().get('/v1/content/home?locale=en-NG').expect(503);
    expect(capture).not.toHaveBeenCalled();
  });
});
