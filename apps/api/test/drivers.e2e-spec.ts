import { EICAR } from '../src/visa/antivirus';

import { staffSession } from './helpers/cars';
import { bearer, login, signUp } from './helpers/flows';
import { DRIVER_DOCUMENTS, driverApplicant, PNG } from './helpers/rides';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Driver onboarding (Cars P4, ADR-050): the application with mock KYC (verified, mismatch, and an
 * unavailable provider that leaves the check for a reviewer), encrypted and scanned documents,
 * vehicles, the payout account behind re-authentication, and staff review gating the `driver`
 * role and going online.
 */
describe('drivers (e2e)', () => {
  let ctx: TestContext;
  let reviewer: { userId: string; headers: Record<string, string> };

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    reviewer = await staffSession(ctx, 'reviewer@suskii.test', ['operations']);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const admin = (path: string) =>
    ctx.http().post(`/v1/admin/drivers/${path}`).set(reviewer.headers);

  async function approveEverything(driverId: string, vehicleId: string): Promise<void> {
    const detail = await ctx
      .http()
      .get(`/v1/admin/drivers/${driverId}`)
      .set(reviewer.headers)
      .expect(200);
    for (const document of detail.body.documents as { id: string }[]) {
      await admin(`${driverId}/documents/${document.id}/review`)
        .send({ decision: 'approve' })
        .expect(204);
    }
    await admin(`${driverId}/vehicles/${vehicleId}/review`)
      .send({ decision: 'approve' })
      .expect(204);
  }

  it('takes an application through review to the road', async () => {
    const applicant = await driverApplicant(ctx, 'chinedu@example.com', { nin: '12345678901' });
    const profile = await ctx
      .http()
      .get('/v1/drivers/me/profile')
      .set(applicant.headers)
      .expect(200);
    expect(profile.body).toMatchObject({
      status: 'pending',
      identityCheck: 'verified',
      licenceCheck: 'verified',
      missing: ['documents', 'vehicle', 'approval'],
    });
    // Identity numbers are encrypted and never returned.
    expect(JSON.stringify(profile.body)).not.toContain('12345678901');
    const row = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: applicant.driverId } });
    expect(row.ninEncrypted).not.toContain('12345678901');
    expect(profile.body.documents.map((d: { status: string }) => d.status)).toEqual(
      DRIVER_DOCUMENTS.map(() => 'clean'),
    );

    // Not a driver yet: no driver routes.
    await ctx
      .http()
      .post('/v1/drivers/me/online')
      .set(applicant.headers)
      .send({ position: { lat: 6.5, lng: 3.4 } })
      .expect(403);

    const early = await admin(`${applicant.driverId}/approve`).send({}).expect(409);
    expect(early.body).toMatchObject({ missing: ['documents', 'vehicle'] });

    const content = await ctx
      .http()
      .get(
        `/v1/admin/drivers/${applicant.driverId}/documents/${profile.body.documents[0].id}/content`,
      )
      .set(reviewer.headers)
      .expect(200);
    expect(Buffer.from(content.body as Buffer).equals(PNG)).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'driver.document_accessed', targetId: profile.body.documents[0].id },
      }),
    ).toBe(1);

    await approveEverything(applicant.driverId, applicant.vehicleId);
    await admin(`${applicant.driverId}/approve`).send({}).expect(204);
    expect(
      await ctx.prisma.userRole.count({ where: { userId: applicant.userId, roleKey: 'driver' } }),
    ).toBe(1);

    // The role arrives with the next sign-in.
    const session = await login(ctx, 'chinedu@example.com');
    const driver = bearer(session.accessToken);
    const online = await ctx
      .http()
      .post('/v1/drivers/me/online')
      .set(driver)
      .send({ position: { lat: 6.5244, lng: 3.3792 } })
      .expect(200);
    expect(online.body).toEqual({ online: true, currentRideId: null });

    await admin(`${applicant.driverId}/suspend`).send({ reason: 'safety_concern' }).expect(204);
    const suspended = await ctx.prisma.driver.findUniqueOrThrow({
      where: { id: applicant.driverId },
    });
    expect(suspended).toMatchObject({ status: 'suspended', online: false, lastLat: null });
    await ctx
      .http()
      .post('/v1/drivers/me/online')
      .set(driver)
      .send({ position: { lat: 6.5244, lng: 3.3792 } })
      .expect(409);
    await admin(`${applicant.driverId}/reinstate`).expect(204);
    await ctx
      .http()
      .post('/v1/drivers/me/online')
      .set(driver)
      .send({ position: { lat: 6.5244, lng: 3.3792 } })
      .expect(200);
  });

  it('never approves a KYC mismatch and lets a reviewer confirm a check the provider missed', async () => {
    const mismatch = await driverApplicant(ctx, 'mismatch@example.com', { nin: '99912345678' });
    await approveEverything(mismatch.driverId, mismatch.vehicleId);
    const refused = await admin(`${mismatch.driverId}/approve`)
      .send({ manualIdentityCheck: true, manualLicenceCheck: true })
      .expect(409);
    expect(refused.body.missing).toEqual(['identity_check']);
    await admin(`${mismatch.driverId}/reject`).send({ reason: 'identity_mismatch' }).expect(204);
    const rejected = await ctx
      .http()
      .get('/v1/drivers/me/profile')
      .set(mismatch.headers)
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', statusReason: 'identity_mismatch' });

    const outage = await driverApplicant(ctx, 'outage@example.com', { nin: '55512345678' });
    const pending = await ctx.http().get('/v1/drivers/me/profile').set(outage.headers).expect(200);
    expect(pending.body.identityCheck).toBe('pending');
    await approveEverything(outage.driverId, outage.vehicleId);
    await admin(`${outage.driverId}/approve`).send({}).expect(409);
    await admin(`${outage.driverId}/approve`).send({ manualIdentityCheck: true }).expect(204);
    const approved = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: outage.driverId } });
    expect(approved).toMatchObject({ status: 'approved', identityCheck: 'verified' });
    expect(approved.identityReference).toBe(`manual:${reviewer.userId}`);
  });

  it('refuses duplicates, the young, infected files and self-review', async () => {
    const first = await driverApplicant(ctx, 'first@example.com', { nin: '22345678901' });
    // The same person (NIN) cannot open a second driver account.
    const other = await signUp(ctx, 'second@example.com');
    const duplicate = await ctx
      .http()
      .post('/v1/drivers/applications')
      .set(bearer(other.accessToken))
      .send({
        givenNames: 'Chinedu',
        surname: 'Okeke',
        dateOfBirth: '1990-04-12',
        cityName: 'Lagos',
        nin: '22345678901',
        licenceNumber: 'LAGDIFFERENT1',
        licenceExpiresOn: '2031-06-30',
      })
      .expect(409);
    expect(duplicate.body.type).toMatch(/driver-exists$/);
    await ctx
      .http()
      .post('/v1/drivers/applications')
      .set(bearer(other.accessToken))
      .send({
        givenNames: 'Young',
        surname: 'Driver',
        dateOfBirth: '2015-01-01',
        cityName: 'Lagos',
        nin: '32345678901',
        licenceNumber: 'LAGYOUNG001',
        licenceExpiresOn: '2031-06-30',
      })
      .expect(422);

    // An infected upload is deleted and rejected, never reviewable.
    await ctx
      .http()
      .put('/v1/drivers/me/documents/selfie')
      .set(first.headers)
      .set('Content-Type', 'image/png')
      .send(Buffer.concat([PNG, Buffer.from(EICAR)]))
      .expect(200);
    await ctx.background.drain();
    const selfie = await ctx.prisma.driverDocument.findFirstOrThrow({
      where: { driverId: first.driverId, kind: 'selfie', supersededAt: null },
    });
    expect(selfie).toMatchObject({ status: 'rejected', storageKey: null, wrappedKey: '' });
    await ctx
      .http()
      .put('/v1/drivers/me/documents/selfie')
      .set(first.headers)
      .set('Content-Type', 'text/plain')
      .send('not a document')
      .expect(415);

    // Staff never review their own driver account.
    const self = await staffSession(ctx, 'self-review@suskii.test', ['operations']);
    const own = await ctx
      .http()
      .post('/v1/drivers/applications')
      .set(self.headers)
      .send({
        givenNames: 'Staff',
        surname: 'Member',
        dateOfBirth: '1988-01-01',
        cityName: 'Lagos',
        nin: '42345678901',
        licenceNumber: 'LAGSTAFF001',
        licenceExpiresOn: '2031-06-30',
      })
      .expect(201);
    await ctx
      .http()
      .post(`/v1/admin/drivers/${own.body.id as string}/reject`)
      .set(self.headers)
      .send({ reason: 'other' })
      .expect(403);
  });

  it('puts the payout account behind a recent sign-in and shows only its last digits', async () => {
    const applicant = await driverApplicant(ctx, 'payout@example.com');
    const saved = await ctx
      .http()
      .put('/v1/drivers/me/payout-account')
      .set(applicant.headers)
      .send({
        account: { bankCode: '058', accountNumber: '0123456789', accountName: 'Chinedu Okeke' },
      })
      .expect(200);
    expect(saved.body.payoutAccount).toEqual({
      bankCode: '058',
      accountEndsWith: '6789',
      accountName: 'Chinedu Okeke',
    });
    const row = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: applicant.driverId } });
    expect(row.payoutAccountEncrypted).not.toContain('0123456789');

    // An old session must re-authenticate.
    await ctx.prisma.session.updateMany({
      where: { userId: applicant.userId },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });
    await ctx
      .http()
      .put('/v1/drivers/me/payout-account')
      .set(applicant.headers)
      .send({
        account: { bankCode: '058', accountNumber: '9999999999', accountName: 'Someone Else' },
      })
      .expect(401);
  });

  it('answers 404 to people who never applied and to other applicants', async () => {
    const stranger = bearer((await signUp(ctx, 'stranger@example.com')).accessToken);
    await ctx.http().get('/v1/drivers/me/profile').set(stranger).expect(404);
    await ctx
      .http()
      .put('/v1/drivers/me/documents/licence')
      .set(stranger)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(404);
    const applicant = await driverApplicant(ctx, 'owner@example.com');
    const other = await driverApplicant(ctx, 'other@example.com');
    await ctx
      .http()
      .post(`/v1/drivers/me/vehicles/${other.vehicleId}/activate`)
      .set(applicant.headers)
      .expect(404);
  });
});
