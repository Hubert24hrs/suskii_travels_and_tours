import { MAX_BEACON_BYTES } from '../src/common/beacon-body.middleware';
import { webVitals } from '../src/telemetry/metrics';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const PATH = '/v1/telemetry/web-vitals';
const REPORT = {
  page: '/',
  device: 'mobile',
  metrics: [
    { name: 'LCP', value: 1834.5 },
    { name: 'CLS', value: 0.04 },
  ],
};

/**
 * ADR-044: field Core Web Vitals arrive as JSON or as a text/plain beacon, become histogram
 * values by page template and device, and nothing else is accepted.
 */
describe('web vitals (e2e)', () => {
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

  it('records each metric with the page template and device only', async () => {
    const lcp = jest.spyOn(webVitals.LCP, 'record');
    const cls = jest.spyOn(webVitals.CLS, 'record');
    await ctx.http().post(PATH).send(REPORT).expect(204);
    expect(lcp).toHaveBeenCalledWith(1834.5, { page: '/', device: 'mobile' });
    expect(cls).toHaveBeenCalledWith(0.04, { page: '/', device: 'mobile' });
  });

  it('accepts the same JSON as a text/plain beacon, from a visitor without a session', async () => {
    const record = jest.spyOn(webVitals.INP, 'record');
    await ctx
      .http()
      .post(PATH)
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify({ ...REPORT, metrics: [{ name: 'INP', value: 120 }] }))
      .expect(204);
    expect(record).toHaveBeenCalledWith(120, { page: '/', device: 'mobile' });
  });

  it('refuses unknown pages, repeated or impossible metrics and URLs in place of templates', async () => {
    const bad = [
      { ...REPORT, page: '/bookings/01a115b6-a055-75e1-8bba-d44e5aa54399' },
      { ...REPORT, device: 'tablet' },
      { ...REPORT, metrics: [] },
      { ...REPORT, metrics: [REPORT.metrics[0], REPORT.metrics[0]] },
      { ...REPORT, metrics: [{ name: 'LCP', value: -1 }] },
      { ...REPORT, metrics: [{ name: 'CLS', value: 51 }] },
      { ...REPORT, metrics: [{ name: 'FID', value: 10 }] },
    ];
    for (const body of bad) {
      const response = await ctx.http().post(PATH).send(body).expect(400);
      expect(response.body.type).toBe('urn:suskii:problem:validation-failed');
    }
  });

  it('answers problems for broken or oversized beacons', async () => {
    const malformed = await ctx
      .http()
      .post(PATH)
      .set('Content-Type', 'text/plain')
      .send('{"page":')
      .expect(400);
    expect(malformed.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(malformed.body.type).toBe('urn:suskii:problem:malformed-body');

    const huge = await ctx
      .http()
      .post(PATH)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ ...REPORT, padding: 'x'.repeat(MAX_BEACON_BYTES) }))
      .expect(413);
    expect(huge.body.type).toBe('urn:suskii:problem:payload-too-large');
  });

  it('never parses text/plain bodies on other routes (no JSON by cross-site form)', async () => {
    const response = await ctx
      .http()
      .post('/v1/privacy/cookie-consents')
      .set('Content-Type', 'text/plain')
      .send(
        JSON.stringify({
          consentId: '01a115b6-a055-75e1-8bba-d44e5aa54399',
          policyVersion: '2026-10-06',
          choices: { analytics: true, marketing: true },
        }),
      )
      .expect(400);
    expect(response.body.type).toBe('urn:suskii:problem:validation-failed');
  });
});
