import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../src/auth/decorators';
import { Contract } from '../src/contract/contract';
import { buildOpenApiDocument } from '../src/openapi/openapi';

import { bearer, signUp } from './helpers/flows';
import { createTestApp, resetState, WEB_ORIGIN, type TestContext } from './helpers/test-app';

const orderBody = z.object({
  amount: z.number().int(),
  slowMs: z.number().int().max(2000).optional(),
});

/** A stand-in for the phase 5 booking endpoint, to exercise the idempotency layer. */
@Controller('test-orders')
class TestOrdersController {
  calls = 0;

  @Public()
  @Post()
  @Contract({
    operationId: 'testCreateOrder',
    summary: 'Test-only idempotent write',
    tags: ['Test'],
    body: orderBody,
    responses: { 201: z.object({ id: z.uuid(), amount: z.number(), call: z.number() }) },
    idempotent: true,
  })
  async create(@Body() body: z.infer<typeof orderBody>): Promise<unknown> {
    this.calls += 1;
    const call = this.calls;
    if (body.slowMs) await sleep(body.slowMs);
    if (body.amount < 0) throw new BadRequestException('amount must be positive');
    return { id: randomUUID(), amount: body.amount, call };
  }
}

describe('platform: headers, CORS, limits, idempotency, readiness, contract (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({}, { controllers: [TestOrdersController] });
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('security headers', () => {
    it.each(['/health', '/v1/does-not-exist', '/v1/me'])('are set on %s', async (path) => {
      const response = await ctx.http().get(path);
      expect(response.headers).toMatchObject({
        'content-security-policy':
          "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
        'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'cross-origin-resource-policy': 'same-site',
        'cross-origin-opener-policy': 'same-origin',
        'cache-control': 'no-store',
      });
      expect(response.headers['permissions-policy']).toContain('camera=()');
      expect(response.headers['permissions-policy']).toContain('payment=()');
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]{8,128}$/);
    });

    it('renders errors as problem+json without internals, echoing safe request ids only', async () => {
      const notFound = await ctx
        .http()
        .get('/v1/nope?token=secret')
        .set('X-Request-Id', 'trace-12345678')
        .expect(404);
      expect(notFound.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(notFound.body).toEqual({
        type: 'urn:suskii:problem:not-found',
        title: 'Not found',
        status: 404,
        instance: '/v1/nope',
        requestId: 'trace-12345678',
      });
      const unsafe = await ctx.http().get('/health').set('X-Request-Id', 'bad id <script>');
      expect(unsafe.headers['x-request-id']).not.toContain('<');
    });

    it('rejects oversized bodies with 413', async () => {
      const response = await ctx
        .http()
        .post('/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(150_000) }))
        .expect(413);
      expect(response.body.type).toBe('urn:suskii:problem:payload-too-large');
      const malformed = await ctx
        .http()
        .post('/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":')
        .expect(400);
      expect(malformed.headers['content-type']).toMatch(/application\/problem\+json/);
    });
  });

  describe('CORS', () => {
    it('allows credentialed calls only from allowlisted origins', async () => {
      const allowed = await ctx
        .http()
        .options('/v1/me')
        .set('Origin', WEB_ORIGIN)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
        .expect(204);
      expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      expect(allowed.headers['access-control-allow-headers']).toContain('X-CSRF-Token');

      const denied = await ctx
        .http()
        .options('/v1/me')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'PATCH');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('rate limits', () => {
    it('limits sign-in attempts per IP with 429, Retry-After and RateLimit headers', async () => {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const response = await ctx
          .http()
          .post('/v1/auth/login')
          .send({ email: `user${attempt}@example.com`, password: 'wrong password!' })
          .expect(401);
        expect(Number(response.headers['ratelimit-remaining'])).toBe(10 - attempt);
        expect(response.headers['ratelimit-limit']).toBe('10');
      }
      const limited = await ctx
        .http()
        .post('/v1/auth/login')
        .send({ email: 'user11@example.com', password: 'wrong password!' })
        .expect(429);
      expect(limited.body.type).toBe('urn:suskii:problem:rate-limited');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(limited.headers['ratelimit-reset'])).toBeGreaterThan(0);
      expect(limited.headers['ratelimit-remaining']).toBe('0');
    });

    it('limits OTP sends per phone number, independently of the IP', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await ctx.http().post('/v1/auth/otp/request').send({ phone: '+2348011111111' }).expect(202);
      }
      await ctx.http().post('/v1/auth/otp/request').send({ phone: '+2348011111111' }).expect(429);
      await ctx.http().post('/v1/auth/otp/request').send({ phone: '+2348022222222' }).expect(202);
    });

    it('limits authenticated callers per user and exempts health probes', async () => {
      const session = await signUp(ctx, 'limits@example.com');
      const me = await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(200);
      expect(me.headers['ratelimit-limit']).toBeDefined();
      const health = await ctx.http().get('/health').expect(200);
      expect(health.headers['ratelimit-limit']).toBeUndefined();
    });
  });

  describe('idempotency keys', () => {
    const post = (key: string | null, body: object, token?: string) => {
      const req = ctx.http().post('/v1/test-orders').send(body);
      if (key) req.set('Idempotency-Key', key);
      if (token) req.set(bearer(token));
      return req;
    };

    it('requires a well-formed key', async () => {
      const missing = await post(null, { amount: 1 }).expect(400);
      expect(missing.body.type).toBe('urn:suskii:problem:idempotency-key-required');
      await post('short', { amount: 1 }).expect(400);
    });

    it('replays the first response for retries with the same payload', async () => {
      const first = await post('order-key-0001', { amount: 5000 }).expect(201);
      const retry = await post('order-key-0001', { amount: 5000 }).expect(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(first.headers['idempotent-replayed']).toBeUndefined();
    });

    it('rejects the same key with a different payload', async () => {
      await post('order-key-0002', { amount: 1 }).expect(201);
      const mismatch = await post('order-key-0002', { amount: 2 }).expect(422);
      expect(mismatch.body.type).toBe('urn:suskii:problem:idempotency-key-reused');
    });

    it('answers 409 while the original request is still running', async () => {
      const [a, b] = await Promise.all([
        post('order-key-0003', { amount: 7, slowMs: 400 }),
        sleep(100).then(() => post('order-key-0003', { amount: 7, slowMs: 400 })),
      ]);
      expect([a.status, b.status]).toEqual([201, 409]);
      expect(b.body.type).toBe('urn:suskii:problem:idempotency-request-in-progress');
      expect(b.headers['retry-after']).toBe('1');
      const replay = await post('order-key-0003', { amount: 7, slowMs: 400 }).expect(201);
      expect(replay.body.id).toBe(a.body.id);
    });

    it('releases the key when the request fails, so it can be retried', async () => {
      await post('order-key-0004', { amount: -1 }).expect(400);
      const again = await post('order-key-0004', { amount: -1 }).expect(400);
      expect(again.headers['idempotent-replayed']).toBeUndefined();
      expect(await ctx.prisma.idempotencyKey.count({ where: { key: 'order-key-0004' } })).toBe(0);
    });

    it('scopes keys to the caller', async () => {
      const alice = await signUp(ctx, 'alice-idem@example.com');
      const bob = await signUp(ctx, 'bob-idem@example.com');
      const a = await post('shared-key-0001', { amount: 1 }, alice.accessToken).expect(201);
      const b = await post('shared-key-0001', { amount: 1 }, bob.accessToken).expect(201);
      expect(a.body.id).not.toBe(b.body.id);
    });
  });

  describe('readiness', () => {
    it('reports Postgres and Redis', async () => {
      const ready = await ctx.http().get('/ready').expect(200);
      expect(ready.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    });

    it('returns 503 when a dependency is down', async () => {
      const broken = await createTestApp({ REDIS_URL: 'redis://127.0.0.1:1' });
      try {
        const response = await broken.http().get('/ready').expect(503);
        expect(response.body).toEqual({
          status: 'unavailable',
          checks: { database: 'up', redis: 'down' },
        });
      } finally {
        await broken.close();
      }
    });
  });

  describe('OpenAPI contract', () => {
    it('matches the committed apps/api/openapi.json (run pnpm generate:api after API changes)', async () => {
      const app = await createTestApp();
      try {
        const generated = JSON.parse(JSON.stringify(buildOpenApiDocument(app.app))) as unknown;
        const committed = JSON.parse(
          readFileSync(join(__dirname, '..', 'openapi.json'), 'utf8'),
        ) as unknown;
        expect(generated).toEqual(committed);
      } finally {
        await app.close();
      }
    });

    it('documents 401 on every protected operation and CSRF on every browser write', () => {
      const doc = buildOpenApiDocument(ctx.app);
      let internalOperations = 0;
      for (const [path, operations] of Object.entries(doc.paths)) {
        for (const [method, operation] of Object.entries(operations)) {
          // Service-to-service routes use the internal token, never cookies (ADR-011).
          const internal = path.startsWith('/v1/internal/');
          if (internal) {
            internalOperations += 1;
            expect([path, operation.security]).toEqual([path, [{ internalToken: [] }]]);
          }
          if (!operation.security || internal)
            expect([path, method, operation.responses['401']]).toEqual([
              path,
              method,
              { $ref: '#/components/responses/Problem401' },
            ]);
          if (method !== 'get' && !internal)
            expect(operation.parameters.map((p) => p.name)).toContain('X-CSRF-Token');
        }
      }
      expect(internalOperations).toBe(9);
    });

    it('resolves every $ref (generated clients refuse dangling references)', () => {
      const doc = buildOpenApiDocument(ctx.app);
      const refs = JSON.stringify(doc).match(/"#\/components\/[^"]+"/g) ?? [];
      for (const ref of new Set(refs)) {
        const [, , section, name] = ref.replaceAll('"', '').split('/');
        const components = doc.components as Record<string, Record<string, unknown>>;
        expect([ref, section && name ? name in (components[section] ?? {}) : false]).toEqual([
          ref,
          true,
        ]);
      }
      expect(refs.length).toBeGreaterThan(50);
    });
  });
});
