import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { parseEnv } from '../src/config/env.schema';
import { ObjectStorageError, S3ObjectStorage } from '../src/documents/s3-object-storage';
import { EMPTY_PAYLOAD_HASH, signRequest } from '../src/documents/sigv4';

/**
 * Versity's S3 gateway checks every SigV4 signature as S3 does; pinned by digest (ADR-057). Set
 * E2E_S3_ENDPOINT (with E2E_S3_ACCESS_KEY and E2E_S3_SECRET_KEY) to use a running store instead.
 */
const GATEWAY_IMAGE =
  'versity/versitygw:v1.8.0@sha256:30292fc2eeacc67a36993b01f7a7a5e3361a19cced0e80c1d71cfa2a4b0a2499';
const BUCKET = 'suskii-e2e-documents';

/** The S3 adapter against a real S3 API: signing, round trips, missing objects and refusals. */
describe('S3 object storage (e2e)', () => {
  let container: StartedTestContainer | null = null;
  let endpoint: string;
  let accessKey: string;
  let secretKey: string;

  const storage = (overrides: Record<string, string> = {}) =>
    new S3ObjectStorage(
      parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://unused@127.0.0.1:5432/unused',
        REDIS_URL: 'redis://127.0.0.1:6379',
        OBJECT_STORAGE: 's3',
        OBJECT_STORAGE_ENDPOINT: endpoint,
        OBJECT_STORAGE_REGION: 'us-east-1',
        OBJECT_STORAGE_BUCKET: BUCKET,
        OBJECT_STORAGE_ACCESS_KEY_ID: accessKey,
        OBJECT_STORAGE_SECRET_ACCESS_KEY: secretKey,
        OBJECT_STORAGE_PATH_STYLE: 'true',
        ...overrides,
      }),
    );

  beforeAll(async () => {
    if (process.env.E2E_S3_ENDPOINT) {
      endpoint = process.env.E2E_S3_ENDPOINT;
      accessKey = process.env.E2E_S3_ACCESS_KEY ?? '';
      secretKey = process.env.E2E_S3_SECRET_KEY ?? '';
    } else {
      accessKey = 'e2e-access-key';
      secretKey = 'e2e-secret-key-for-the-gateway';
      container = await new GenericContainer(GATEWAY_IMAGE)
        .withCommand(['--access', accessKey, '--secret', secretKey, 'posix', '/tmp'])
        .withExposedPorts(7070)
        .withWaitStrategy(Wait.forListeningPorts())
        .start();
      endpoint = `http://${container.getHost()}:${container.getMappedPort(7070)}`;
    }
    // The adapter never creates buckets (Terraform does); the test makes its own.
    const url = new URL(endpoint);
    const headers = signRequest({
      method: 'PUT',
      host: url.host,
      path: `/${BUCKET}`,
      headers: {},
      payloadHash: EMPTY_PAYLOAD_HASH,
      region: 'us-east-1',
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      date: new Date(),
    });
    const { host: _host, ...sendHeaders } = headers;
    const created = await fetch(`${endpoint}/${BUCKET}`, { method: 'PUT', headers: sendHeaders });
    // 409: the bucket is there already (a reused store).
    expect([200, 409]).toContain(created.status);
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('stores, reads, overwrites and deletes an object', async () => {
    const store = storage();
    const key = `bookings/${Date.now()}/ticket.pdf`;
    const first = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    await store.put(key, first, 'application/pdf');
    expect(new Uint8Array((await store.get(key)) ?? [])).toEqual(first);

    const second = new Uint8Array(64 * 1024).map((_, index) => index % 251);
    await store.put(key, second, 'application/pdf');
    expect(new Uint8Array((await store.get(key)) ?? [])).toEqual(second);

    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    // Deleting what is not there is not an error.
    await expect(store.delete(key)).resolves.toBeUndefined();
  });

  it('answers null for an object that was never stored', async () => {
    expect(await storage().get('visa/never-stored/passport.png')).toBeNull();
  });

  it('refuses keys that could escape the bucket before any request', async () => {
    const store = storage();
    await expect(store.put('../outside', new Uint8Array([1]), 'text/plain')).rejects.toThrow(
      'Invalid object key',
    );
    await expect(store.get('Bookings/Upper.pdf')).rejects.toThrow('Invalid object key');
  });

  it('reports a rejected signature with the store code and no key or secret', async () => {
    const store = storage({ OBJECT_STORAGE_SECRET_ACCESS_KEY: 'not-the-secret' });
    const key = 'drivers/abc/licence.png';
    const error = await store.put(key, new Uint8Array([1, 2, 3]), 'image/png').then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ObjectStorageError);
    expect((error as ObjectStorageError).status).toBe(403);
    expect((error as ObjectStorageError).code).toBe('SignatureDoesNotMatch');
    expect((error as Error).message).not.toContain(key);
    expect((error as Error).message).not.toContain('not-the-secret');
  });

  it('is refused in production without TLS unless the network is declared private', () => {
    const production = {
      NODE_ENV: 'production',
      OBJECT_STORAGE: 's3',
      OBJECT_STORAGE_ENDPOINT: 'http://storage.internal:7070',
      OBJECT_STORAGE_BUCKET: BUCKET,
      OBJECT_STORAGE_ACCESS_KEY_ID: 'id',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
    };
    const issues = (env: Record<string, string>): string[] => {
      try {
        parseEnv({
          DATABASE_URL: 'postgresql://unused@db:5432/unused?sslmode=verify-full',
          REDIS_URL: 'rediss://cache:6379',
          ...env,
        });
        return [];
      } catch (error) {
        return [(error as Error).message];
      }
    };
    expect(issues(production).join(' ')).toContain('OBJECT_STORAGE_ENDPOINT');
    expect(
      issues({ ...production, OBJECT_STORAGE_ALLOW_PLAINTEXT: 'true' }).join(' '),
    ).not.toContain('OBJECT_STORAGE_ENDPOINT');
    expect(issues({ ...production, OBJECT_STORAGE_BUCKET: '' }).join(' ')).toContain(
      'OBJECT_STORAGE_BUCKET',
    );
  });
});
