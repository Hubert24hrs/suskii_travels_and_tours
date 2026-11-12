import { addDays, localDate } from '@suskii/shared';

import type { AppConfig } from '../src/config/config';
import {
  factorContext,
  idempotencySealContext,
  passportContext,
} from '../src/crypto/encryption-contexts';
import { ENCRYPTED_FIELDS, reencryptFields } from '../src/crypto/encrypted-fields';
import { FieldEncryption, LocalKeyFieldEncryption } from '../src/crypto/field-encryption';

import { bearer, enrolTotp, signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * ADR-038: rotating the field-encryption key. Data written under `k1` stays readable while `k1`
 * is a previous key, `keys:reencrypt` moves every envelope (text and JSON columns) to `k2`, and a
 * second run finds nothing left.
 */
describe('field encryption key rotation (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetState(ctx);
  });
  afterAll(async () => {
    await resetState(ctx);
    await ctx.close();
  });

  it('re-encrypts every envelope under the new key and keeps the data', async () => {
    const session = await signUp(ctx, 'rotation@example.com');
    const { secret } = await enrolTotp(ctx, session.accessToken);
    const saved = await ctx
      .http()
      .post('/v1/me/travellers')
      .set(bearer(session.accessToken))
      .send({
        title: 'ms',
        gender: 'f',
        givenNames: 'Ngozi',
        surname: 'Eze',
        dateOfBirth: '1991-05-02',
        nationality: 'NG',
        document: {
          number: 'B1234567',
          issuingCountry: 'NG',
          expiryDate: addDays(localDate(new Date(), 'UTC'), 2000),
        },
      })
      .expect(201);
    const appCipher = ctx.app.get(FieldEncryption);
    const sealed = await ctx.prisma.idempotencyKey.create({
      data: {
        scope: `user:${session.userId}`,
        key: 'rotation-e2e',
        requestHash: 'x'.repeat(64),
        status: 'completed',
        responseStatus: 201,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await ctx.prisma.idempotencyKey.update({
      where: { id: sealed.id },
      data: {
        responseBody: {
          sealed: appCipher.encrypt('{"guestToken":"t"}', idempotencySealContext(sealed.id)),
        },
      },
    });

    const rotated = new LocalKeyFieldEncryption({
      ...ctx.config,
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 10).toString('base64'),
      FIELD_ENCRYPTION_KEY_ID: 'k2',
      FIELD_ENCRYPTION_PREVIOUS_KEYS: [`k1:${ctx.config.FIELD_ENCRYPTION_KEY ?? ''}`],
    } satisfies AppConfig);
    const staleOf = (results: { field: string; stale: number }[], field: string) =>
      results.find((result) => result.field === field)?.stale;

    const dryRun = await reencryptFields(ctx.prisma, rotated, { confirm: false });
    expect(dryRun.map((result) => result.field)).toHaveLength(ENCRYPTED_FIELDS.length);
    expect(staleOf(dryRun, 'mfa_factors.secret_ciphertext')).toBe(1);
    expect(staleOf(dryRun, 'travellers.passport_encrypted')).toBe(1);
    expect(staleOf(dryRun, 'idempotency_keys.response_body.sealed')).toBe(1);
    expect(dryRun.every((result) => result.rewritten === 0)).toBe(true);

    // One row per batch exercises the paging.
    const run = await reencryptFields(ctx.prisma, rotated, { confirm: true, batchSize: 1 });
    expect(run.every((result) => result.rewritten === result.stale)).toBe(true);
    const again = await reencryptFields(ctx.prisma, rotated, { confirm: false });
    expect(again.every((result) => result.stale === 0)).toBe(true);

    const factor = await ctx.prisma.mfaFactor.findFirstOrThrow({
      where: { userId: session.userId },
    });
    expect(factor.secretCiphertext.startsWith('v2.k2.')).toBe(true);
    expect(rotated.decrypt(factor.secretCiphertext, factorContext(session.userId))).toBe(secret);
    const traveller = await ctx.prisma.traveller.findUniqueOrThrow({
      where: { id: saved.body.id as string },
    });
    expect(
      rotated.decrypt(
        traveller.passportEncrypted ?? '',
        passportContext('traveller', traveller.id),
      ),
    ).toBe('B1234567');
    const replay = await ctx.prisma.idempotencyKey.findUniqueOrThrow({ where: { id: sealed.id } });
    const envelope = (replay.responseBody as { sealed: string }).sealed;
    expect(envelope.startsWith('v2.k2.')).toBe(true);
    expect(rotated.decrypt(envelope, idempotencySealContext(sealed.id))).toBe('{"guestToken":"t"}');

    // The old key alone can no longer read anything.
    expect(() => appCipher.decrypt(envelope, idempotencySealContext(sealed.id))).toThrow();
  });
});
