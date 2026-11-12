import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { ObjectStorage } from '../src/documents/object-storage';
import { EICAR } from '../src/visa/antivirus';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * Phase 8 acceptance (ADR-026): visa documents are encrypted at rest and only reachable through
 * short-lived signed links minted for their owner or a visa officer. Plus eligibility from the
 * rules table, type sniffing and size limits, virus scanning, submission, the officer workflow
 * and retention.
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });
const MAX_BYTES = 200_000;

let keySequence = 0;
const idempotencyKey = (): string => `e2e-visa-${Date.now()}-${(keySequence += 1)}`;

const PDF = Buffer.from('%PDF-1.7\n% PASSPORT-SCAN-MARKER for the e2e suite\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('PHOTO-MARKER'),
]);

const applicant = (givenNames: string, surname: string) => ({
  type: 'adult',
  title: 'mr',
  gender: 'm',
  givenNames,
  surname,
  dateOfBirth: '1988-06-15',
  nationality: 'NG',
  document: {
    number: `A${Math.floor(Math.random() * 1e7)}`,
    issuingCountry: 'NG',
    expiryDate: inDays(3000),
  },
});

interface Application {
  id: string;
  status: string;
  canSubmit: boolean;
  checklist: { key: string; document: { id: string; status: string; fileName: string } | null }[];
  messages: { status: string | null; message: string | null }[];
}

describe('visa assistance (e2e): eligibility, documents and officers', () => {
  let ctx: TestContext;
  let officer: Record<string, string>;
  let catalog: Record<string, string>;
  let productId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ VISA_DOCUMENT_MAX_BYTES: MAX_BYTES });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    officer = (await staff('officer@suskii.test', ['visa_officer'])).headers;
    catalog = (await staff('catalog@suskii.test', ['content_manager'])).headers;
    const product = await ctx
      .http()
      .post('/v1/admin/visa-products')
      .set(catalog)
      .send({
        slug: 'uk-visitor',
        title: 'UK visitor visa assistance',
        summary: 'We check and submit your application.',
        destination: 'GB',
        purposes: ['tourism', 'business'],
        processingDaysMin: 15,
        processingDaysMax: 30,
        price: ngn(80_000),
        checklist: [
          { key: 'passport', label: 'Passport', description: 'Bio page', required: true },
          { key: 'photo', label: 'Photo', description: 'Plain background', required: true },
          { key: 'invitation', label: 'Invitation', description: 'If hosted', required: false },
        ],
      })
      .expect(201);
    productId = product.body.id as string;
    await ctx
      .http()
      .patch(`/v1/admin/visa-products/${productId}`)
      .set(catalog)
      .send({ status: 'published' })
      .expect(204);
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function staff(email: string, roles: Parameters<typeof grantRoles>[2]) {
    const initial = await signUp(ctx, email);
    await grantRoles(ctx, initial.userId, roles);
    const { secret } = await enrolTotp(ctx, initial.accessToken);
    const pending = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const verified = await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, code: totp(secret, 1) })
      .expect(200);
    return { userId: initial.userId, headers: bearer(verified.body.accessToken as string) };
  }

  /** A confirmed visa assistance booking for one applicant, as a guest. */
  async function confirmedApplication(surname = 'Okoro') {
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({
        kind: 'visa',
        productId,
        purpose: 'tourism',
        nationality: 'NG',
        travelDate: inDays(60),
        travellers: { adults: 1, children: 0, infants: 0 },
      })
      .expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: `${surname.toLowerCase()}@example.com`, phone: '+2348012345678' },
        passengers: [applicant('Chinedu', surname)],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    const bookingId = created.body.booking.id as string;
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(token)
      .send({})
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const booking = await ctx.http().get(`/v1/bookings/${bookingId}`).set(token).expect(200);
    const applicationId = booking.body.visa.applications[0].id as string;
    const base = `/v1/bookings/${bookingId}/visa-applications/${applicationId}`;
    return { bookingId, applicationId, token, base };
  }

  function upload(
    base: string,
    key: string,
    bytes: Buffer,
    headers: Record<string, string>,
    contentType = 'application/pdf',
  ) {
    return ctx
      .http()
      .put(`${base}/documents/${key}`)
      .set(headers)
      .set('Content-Type', contentType)
      .set('X-File-Name', encodeURIComponent('Scan (1) Ọ̀kọ̀rọ̀.pdf'))
      .send(bytes);
  }

  function download(url: string) {
    return ctx
      .http()
      .get(url)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  }

  describe('eligibility', () => {
    it('answers from the officers’ rules and never guesses', async () => {
      const unknown = await ctx
        .http()
        .get('/v1/visa/eligibility?nationality=NG&destination=GB&purpose=tourism')
        .expect(200);
      expect(unknown.body).toMatchObject({
        requirement: 'unknown',
        disclaimer: expect.stringContaining('issuing government'),
      });
      await ctx
        .http()
        .get('/v1/visa/eligibility?nationality=NG&destination=NG&purpose=tourism')
        .expect(400);

      // Only visa officers maintain rules.
      await ctx
        .http()
        .put('/v1/admin/visa-rules')
        .set(catalog)
        .send({
          nationality: 'NG',
          destination: 'GB',
          purpose: 'tourism',
          requirement: 'visa_required',
        })
        .expect(403);
      await ctx
        .http()
        .put('/v1/admin/visa-rules')
        .set(officer)
        .send({
          nationality: 'NG',
          destination: 'GB',
          purpose: 'tourism',
          requirement: 'visa_required',
          notes: 'Apply at least four weeks ahead.',
          verifiedAt: today,
        })
        .expect(200);
      const known = await ctx
        .http()
        .get('/v1/visa/eligibility?nationality=NG&destination=GB&purpose=tourism')
        .expect(200);
      expect(known.body).toMatchObject({
        requirement: 'visa_required',
        notes: 'Apply at least four weeks ahead.',
        verifiedAt: today,
        sample: false,
        products: [{ slug: 'uk-visitor', price: ngn(80_000), processingDaysMax: 30 }],
      });
      const rules = await ctx
        .http()
        .get('/v1/admin/visa-rules?nationality=NG')
        .set(officer)
        .expect(200);
      expect(rules.body.rules).toHaveLength(1);
      await ctx
        .http()
        .delete(`/v1/admin/visa-rules/${rules.body.rules[0].id as string}`)
        .set(officer)
        .expect(204);
      const product = await ctx.http().get('/v1/visa/products/uk-visitor').expect(200);
      expect(product.body.checklist.map((item: { key: string }) => item.key)).toEqual([
        'passport',
        'photo',
        'invitation',
      ]);
    });
  });

  describe('documents', () => {
    it('stores uploads encrypted and serves them only through signed links for the owner and officers', async () => {
      const { base, token, bookingId, applicationId } = await confirmedApplication();
      const other = await confirmedApplication('Bello');

      // Strangers and other travellers cannot see or upload.
      await ctx.http().get(base).expect(404);
      await upload(base, 'passport', PDF, {}).expect(404);
      await upload(base, 'passport', PDF, other.token).expect(404);
      await ctx.http().get(base).set(other.token).expect(404);

      // Only PDF, JPEG and PNG, judged by the bytes, within the size limit.
      await upload(base, 'passport', PDF, token, 'text/html').expect(415);
      await upload(base, 'passport', Buffer.from('<html><script>alert(1)</script>'), token).expect(
        415,
      );
      await upload(base, 'passport', Buffer.concat([PDF, Buffer.alloc(MAX_BYTES)]), token).expect(
        413,
      );
      await upload(base, 'unknown_item', PDF, token).expect(404);

      const uploaded = await upload(base, 'passport', PDF, token).expect(200);
      const passport = (uploaded.body as Application).checklist.find(
        (item) => item.key === 'passport',
      );
      expect(passport?.document).toMatchObject({
        status: 'pending_scan',
        fileName: 'Scan-1-Okoro.pdf',
      });
      await ctx.background.drain();
      const afterScan = await ctx.http().get(base).set(token).expect(200);
      const documentId = (afterScan.body as Application).checklist[0]?.document?.id ?? '';
      expect((afterScan.body as Application).checklist[0]?.document?.status).toBe('clean');

      // At rest: ciphertext only, and the data key is wrapped.
      const row = await ctx.prisma.visaDocument.findUniqueOrThrow({ where: { id: documentId } });
      const blob = await ctx.app.get(ObjectStorage).get(row.storageKey ?? '');
      expect(blob).not.toBeNull();
      expect(blob?.includes('PASSPORT-SCAN-MARKER')).toBe(false);
      expect(blob?.includes('%PDF')).toBe(false);
      expect(row.wrappedKey.startsWith('v2.k1.')).toBe(true);
      expect(row.fileNameEncrypted).not.toContain('Okoro');

      // The owner's link works once for them; tampering with any part of it fails.
      const link = await ctx
        .http()
        .post(`${base}/documents/${documentId}/link`)
        .set(token)
        .expect(200);
      expect(link.body.url).toMatch(
        /^\/v1\/visa\/documents\/[0-9a-f-]+\/content\?expires=\d+&viewer=c\./,
      );
      const content = await download(link.body.url as string).expect(200);
      expect((content.body as Buffer).equals(PDF)).toBe(true);
      expect(content.headers['content-type']).toContain('application/pdf');
      expect(content.headers['content-disposition']).toMatch(
        /^attachment; filename="Scan-1-Okoro\.pdf"$/,
      );
      expect(content.headers['x-content-type-options']).toBe('nosniff');
      expect(content.headers['content-security-policy']).toContain('sandbox');
      expect(content.headers['cache-control']).toBe('no-store');

      const url = new URL(link.body.url as string, 'http://api.test');
      const tamper = (key: string, value: string) => {
        const copy = new URL(url);
        copy.searchParams.set(key, value);
        return `${copy.pathname}${copy.search}`;
      };
      await download(tamper('signature', `${url.searchParams.get('signature') ?? ''}x`)).expect(
        404,
      );
      await download(tamper('signature', 'A'.repeat(43))).expect(404);
      await download(tamper('expires', String(Date.now() + 3_600_000))).expect(404);
      await download(tamper('viewer', `c.${other.bookingId}`)).expect(404);
      await download(`/v1/visa/documents/${documentId}/content`).expect(400);
      // Another traveller cannot mint a link to this document.
      await ctx
        .http()
        .post(`${other.base}/documents/${documentId}/link`)
        .set(other.token)
        .expect(404);

      // Visa officers get their own audited links; other staff cannot.
      await ctx.http().post(`/v1/admin/visa-documents/${documentId}/link`).set(catalog).expect(403);
      const officerLink = await ctx
        .http()
        .post(`/v1/admin/visa-documents/${documentId}/link`)
        .set(officer)
        .expect(200);
      expect(officerLink.body.url).toContain('viewer=s.');
      expect(
        ((await download(officerLink.body.url as string).expect(200)).body as Buffer).equals(PDF),
      ).toBe(true);

      const audited = await ctx.prisma.auditLog.findMany({
        where: { targetId: documentId },
        select: { action: true },
      });
      const actions = audited.map((entry) => entry.action);
      expect(actions.filter((action) => action === 'visa.document_link_issued')).toHaveLength(2);
      expect(actions.filter((action) => action === 'visa.document_accessed')).toHaveLength(2);
      expect(actions).toEqual(
        expect.arrayContaining(['visa.document_uploaded', 'visa.document_scanned']),
      );
      expect(bookingId).not.toBe(applicationId);
    });

    it('deletes infected uploads and asks for another copy', async () => {
      const { base, token } = await confirmedApplication();
      const infected = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(EICAR)]);
      await upload(base, 'passport', infected, token).expect(200);
      await ctx.background.drain();
      const application = (await ctx.http().get(base).set(token).expect(200)).body as Application;
      expect(application.checklist[0]?.document?.status).toBe('infected');
      expect(application.messages.at(-1)?.message).toContain('virus check');
      const row = await ctx.prisma.visaDocument.findFirstOrThrow({ where: { status: 'infected' } });
      expect(row).toMatchObject({ storageKey: null, wrappedKey: '' });
      expect(row.deletedAt).not.toBeNull();
    });
  });

  describe('submission and the officer workflow', () => {
    it('submits a complete checklist, lets officers ask for more and records the decision', async () => {
      const { base, token, applicationId } = await confirmedApplication();
      await ctx
        .http()
        .post(`${base}/submit`)
        .set(token)
        .expect(422)
        .expect((response) => expect(response.body.missing).toEqual(['passport', 'photo']));
      await upload(base, 'passport', PDF, token).expect(200);
      await upload(base, 'photo', PNG, token, 'image/png').expect(200);
      await ctx.background.drain();
      const ready = (await ctx.http().get(base).set(token).expect(200)).body as Application;
      expect(ready.canSubmit).toBe(true);
      const submitted = await ctx.http().post(`${base}/submit`).set(token).expect(200);
      expect(submitted.body).toMatchObject({
        status: 'submitted',
        canUpload: false,
        canSubmit: false,
      });
      await upload(base, 'photo', PNG, token, 'image/png').expect(409);

      const queue = await ctx
        .http()
        .get('/v1/admin/visa-applications?status=submitted')
        .set(officer)
        .expect(200);
      expect(queue.body.applications).toEqual([
        expect.objectContaining({
          id: applicationId,
          applicantName: 'CHINEDU OKORO',
          destination: 'GB',
        }),
      ]);
      await ctx.http().get('/v1/admin/visa-applications').set(catalog).expect(403);

      await ctx
        .http()
        .post(`/v1/admin/visa-applications/${applicationId}/transitions`)
        .set(officer)
        .send({ to: 'approved' })
        .expect(409);
      await ctx
        .http()
        .post(`/v1/admin/visa-applications/${applicationId}/transitions`)
        .set(officer)
        .send({ to: 'in_review', note: 'Checking bank statements.' })
        .expect(200);
      const detail = await ctx
        .http()
        .get(`/v1/admin/visa-applications/${applicationId}`)
        .set(officer)
        .expect(200);
      const photoId =
        (detail.body.checklist as Application['checklist']).find((item) => item.key === 'photo')
          ?.document?.id ?? '';
      expect(detail.body.passport).toMatchObject({ issuingCountry: 'NG' });
      expect(detail.body.allowedTransitions).toEqual(['action_required', 'lodged', 'withdrawn']);

      await ctx
        .http()
        .post(`/v1/admin/visa-documents/${photoId}/reject`)
        .set(officer)
        .send({ message: 'The photo has a patterned background.' })
        .expect(204);
      ctx.emails.outbox.length = 0;
      await ctx
        .http()
        .post(`/v1/admin/visa-applications/${applicationId}/transitions`)
        .set(officer)
        .send({
          to: 'action_required',
          message: 'Please send a new photo.',
          note: 'Internal only.',
        })
        .expect(200);
      await ctx.background.drain();
      const email = ctx.emails.outbox.find((message) => message.template === 'visa-update');
      expect(email?.text).toContain('Please send a new photo.');
      expect(email?.text).not.toContain('Internal only.');
      expect(email?.text).toContain('issuing government');

      // The traveller sees the message, never the internal note, and replaces the photo.
      const needsAction = (await ctx.http().get(base).set(token).expect(200)).body as Application;
      expect(needsAction.status).toBe('action_required');
      expect(JSON.stringify(needsAction)).not.toContain('Internal only.');
      expect(JSON.stringify(needsAction)).not.toContain('Checking bank statements.');
      expect(needsAction.checklist.find((item) => item.key === 'photo')?.document?.status).toBe(
        'rejected',
      );
      await upload(base, 'photo', PNG, token, 'image/png').expect(200);
      await ctx.background.drain();
      await ctx.http().post(`${base}/submit`).set(token).expect(200);

      for (const to of ['in_review', 'lodged', 'approved']) {
        await ctx
          .http()
          .post(`/v1/admin/visa-applications/${applicationId}/transitions`)
          .set(officer)
          .send({ to })
          .expect(200);
      }
      const approved = await ctx
        .http()
        .get(`/v1/admin/visa-applications/${applicationId}`)
        .set(officer)
        .expect(200);
      expect(approved.body).toMatchObject({ status: 'approved', allowedTransitions: [] });
      expect(approved.body.closedAt).not.toBeNull();

      // Retention: after the period, the files go and links stop working.
      const current = approved.body.checklist[0].document.id as string;
      const link = await ctx
        .http()
        .post(`/v1/admin/visa-documents/${current}/link`)
        .set(officer)
        .expect(200);
      await ctx.prisma.visaApplication.update({
        where: { id: applicationId },
        data: { closedAt: new Date(Date.now() - 91 * 86_400_000) },
      });
      const pruned = await ctx.http().post('/v1/internal/visa/prune').set(INTERNAL).expect(200);
      expect(pruned.body.deleted).toBeGreaterThanOrEqual(2);
      await download(link.body.url as string).expect(404);
      const remaining = await ctx.prisma.visaDocument.count({
        where: { applicationId, OR: [{ storageKey: { not: null } }, { wrappedKey: { not: '' } }] },
      });
      expect(remaining).toBe(0);
    });

    it('retries scans the background missed', async () => {
      const { base, token } = await confirmedApplication();
      await upload(base, 'passport', PDF, token).expect(200);
      await ctx.background.drain();
      await ctx.prisma.visaDocument.updateMany({
        data: { status: 'pending_scan', uploadedAt: new Date(Date.now() - 5 * 60_000) },
      });
      const run = await ctx.http().post('/v1/internal/visa/scan-due').set(INTERNAL).expect(200);
      expect(run.body).toEqual({ scanned: 1, clean: 1, infected: 0, failed: 0 });
    });
  });
});
