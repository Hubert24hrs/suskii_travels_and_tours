import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';
import type { Response } from 'supertest';

import { MockPaymentProvider } from '../src/payments/mock-payment-provider';

import {
  adminOperations,
  cleanAdminContent,
  committedOpenApi,
  staffSession,
  type AdminOperation,
  type OpenApiDocument,
} from './helpers/admin';
import { bearer, enrolTotp, PASSWORD, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * ADR-034, phase 10 acceptance: every admin mutation, performed successfully through the route
 * its OpenAPI operation names, records one of the audit actions it declares (`x-audit`) with the
 * staff member as actor. The last test fails if any admin mutation was not exercised.
 */
const DOCUMENT: OpenApiDocument = committedOpenApi();
const MUTATIONS = adminOperations(DOCUMENT).filter((operation) => operation.method !== 'get');

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });
const policy = [
  { daysBefore: 7, refundBps: 10_000 },
  { daysBefore: 0, refundBps: 0 },
];
let keySequence = 0;
const idempotencyKey = (): string => `e2e-admin-audit-${Date.now()}-${(keySequence += 1)}`;

const PDF = Buffer.from('%PDF-1.7\n% admin audit e2e\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('PHOTO'),
]);

const traveller = (givenNames: string, surname: string) => ({
  type: 'adult',
  title: 'mr',
  gender: 'm',
  givenNames,
  surname,
  dateOfBirth: '1985-02-11',
  nationality: 'NG',
  document: {
    number: `A${Math.floor(Math.random() * 1e7)}`,
    issuingCountry: 'NG',
    expiryDate: inDays(3000),
  },
});

function successStatus(operation: AdminOperation): number {
  const responses = (
    DOCUMENT.paths[operation.path]?.[operation.method] as {
      responses?: Record<string, unknown>;
    }
  )?.responses;
  const code = Object.keys(responses ?? {}).find((status) => status.startsWith('2'));
  if (!code) throw new Error(`${operation.operationId} declares no success response`);
  return Number(code);
}

describe('admin audit coverage (e2e)', () => {
  let ctx: TestContext;
  let admin: TokenSession;
  let approver: TokenSession;
  const covered = new Set<string>();

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, REFUND_APPROVAL_THRESHOLD_NGN: 0 });
    await ctx.background.drain();
    await resetState(ctx);
    await cleanAdminContent(ctx);
    admin = await staffSession(ctx, 'audit-admin@suskii.test', ['super_admin']);
    approver = await staffSession(ctx, 'audit-approver@suskii.test', ['super_admin']);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await cleanAdminContent(ctx);
    await ctx.close();
  });

  function operation(operationId: string): AdminOperation {
    const found = MUTATIONS.find((candidate) => candidate.operationId === operationId);
    if (!found) throw new Error(`${operationId} is not an admin mutation`);
    return found;
  }

  /**
   * Performs the mutation on the route its operation names, expects the declared success status
   * and at least one new audit entry with one of its declared actions and the actor.
   */
  async function audited(
    operationId: string,
    params: Record<string, string>,
    send: (request: ReturnType<ReturnType<TestContext['http']>['post']>) => PromiseLike<Response>,
    actor: TokenSession = admin,
  ): Promise<Response> {
    const op = operation(operationId);
    const path = op.path.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = params[name];
      if (value === undefined) throw new Error(`${operationId}: missing path parameter ${name}`);
      return encodeURIComponent(value);
    });
    const where = { action: { in: op.audit }, actorUserId: actor.userId };
    const before = await ctx.prisma.auditLog.count({ where });
    const response = await send(ctx.http()[op.method](path).set(bearer(actor.accessToken)));
    expect({ operationId, status: response.status }).toEqual({
      operationId,
      status: successStatus(op),
    });
    await ctx.background.drain();
    const after = await ctx.prisma.auditLog.count({ where });
    expect({ operationId, audited: after > before }).toEqual({ operationId, audited: true });
    covered.add(operationId);
    return response;
  }

  const none = (request: PromiseLike<Response>) => request;

  it('users: roles, disable, enable and MFA reset', async () => {
    const target = await signUp(ctx, 'audit-target@example.com');
    await enrolTotp(ctx, target.accessToken);
    await audited('adminSetUserRoles', { id: target.userId }, (request) =>
      request.send({ roles: ['customer', 'support'] }),
    );
    await audited('adminDisableUser', { id: target.userId }, none);
    await audited('adminEnableUser', { id: target.userId }, none);
    await audited('adminResetUserMfa', { id: target.userId }, none);
    await audited('adminRevokeUserSessions', { id: target.userId }, none);
  });

  it('pricing: markup and fee rules', async () => {
    const markup = await audited('adminCreateMarkupRule', {}, (request) =>
      request.send({
        name: 'Domestic flights',
        vertical: 'flights',
        priority: 100,
        active: true,
        channel: null,
        userTier: null,
        supplier: null,
        originCode: null,
        destinationCode: null,
        originCountry: 'NG',
        destinationCountry: 'NG',
        carrierCode: null,
        cabinClass: null,
        type: 'percentage',
        value: 300,
        currency: null,
        minAmountMinor: null,
        maxAmountMinor: null,
        validFrom: null,
        validTo: null,
      }),
    );
    await audited('adminUpdateMarkupRule', { id: markup.body.id as string }, (request) =>
      request.send({ value: 350, active: false }),
    );
    const fee = await audited('adminCreateFeeRule', {}, (request) =>
      request.send({
        code: 'service_fee',
        label: 'Service fee',
        vertical: 'hotels',
        active: true,
        sortOrder: 0,
        channel: null,
        userTier: null,
        type: 'fixed',
        value: 150_000,
        currency: 'NGN',
        basis: 'per_booking',
        minAmountMinor: null,
        maxAmountMinor: null,
        validFrom: null,
        validTo: null,
      }),
    );
    await audited('adminUpdateFeeRule', { id: fee.body.id as string }, (request) =>
      request.send({ active: false }),
    );
  });

  it('promos, deal routes and destinations', async () => {
    const promo = await audited('adminCreatePromoCode', {}, (request) =>
      request.send({
        code: 'e2eaudit10',
        description: 'Audit coverage',
        type: 'percentage',
        value: 1000,
        currency: 'NGN',
        maxDiscountMinor: 500_000,
        minSpendMinor: null,
        verticals: [],
        validFrom: null,
        validTo: null,
        maxRedemptions: 100,
        maxRedemptionsPerUser: 1,
        requiresAccount: true,
        active: true,
      }),
    );
    expect(promo.body.code).toBe('E2EAUDIT10');
    await audited('adminUpdatePromoCode', { id: promo.body.id as string }, (request) =>
      request.send({ active: false }),
    );

    const route = await audited('adminCreateDealRoute', {}, (request) =>
      request.send({
        slug: 'e2e-lagos-to-accra-first',
        originCode: 'LOS',
        destinationCode: 'ACC',
        cabinClass: 'first',
        stayNights: 5,
        active: false,
        sortOrder: 900,
      }),
    );
    await audited('adminUpdateDealRoute', { id: route.body.id as string }, (request) =>
      request.send({ stayNights: 6 }),
    );

    const city = await ctx.prisma.city.findFirstOrThrow({
      where: { destination: null, countryCode: 'NG' },
      orderBy: { name: 'asc' },
    });
    const destination = await audited('adminCreateDestination', {}, (request) =>
      request.send({
        cityId: city.id,
        slug: 'e2e-destination',
        featured: false,
        sortOrder: 900,
        imageUrl: null,
        published: false,
      }),
    );
    await audited('adminUpdateDestination', { id: destination.body.id as string }, (request) =>
      request.send({ sortOrder: 901 }),
    );
  });

  it('content: CMS blocks, FAQs and trust signals', async () => {
    await audited('adminSaveCmsBlock', { locale: 'en-NG', key: 'page.e2e-audit' }, (request) =>
      request.send({
        content: {
          title: 'Audit page',
          group: 'company',
          sections: [{ heading: null, paragraphs: ['Only for the audit suite.'] }],
        },
        published: false,
      }),
    );
    const faq = await audited('adminCreateFaq', {}, (request) =>
      request.send({
        locale: 'en-US',
        question: 'E2E: is this audited?',
        answer: 'Yes.',
        sortOrder: 900,
        published: false,
      }),
    );
    await audited('adminUpdateFaq', { id: faq.body.id as string }, (request) =>
      request.send({ answer: 'Yes, every change.' }),
    );

    await ctx.prisma.trustSignal.create({
      data: { key: 'e2e_awards', label: 'Award winning', sortOrder: 900 },
    });
    await audited('adminUpdateTrustSignal', { key: 'e2e_awards' }, (request) =>
      request.send({ label: 'Award-winning support' }),
    );
    await audited('adminVerifyTrustSignal', { key: 'e2e_awards' }, (request) =>
      request.send({ evidenceUrl: 'https://example.com/award.pdf' }),
    );
    await audited('adminUnverifyTrustSignal', { key: 'e2e_awards' }, (request) =>
      request.send({ reason: 'Award expired' }),
    );
  });

  it('Suskii Prime plans', async () => {
    const plan = await audited('adminCreatePrimePlan', {}, (request) =>
      request.send({
        slug: 'prime-audit',
        name: 'Suskii Prime Audit',
        summary: 'Only for the audit suite.',
        period: 'year',
        prices: [{ amountMinor: 2_500_000, currency: 'NGN' }],
        benefits: { markupShareBps: 5_000, waivedFeeCodes: [], prioritySupport: false },
      }),
    );
    await audited('adminUpdatePrimePlan', { id: plan.body.id as string }, (request) =>
      request.send({ summary: 'Changed by the audit suite.' }),
    );
  });

  describe('catalog, bookings, vouchers and refunds', () => {
    let lagosId: string;
    let tourDepartureId: string;
    let bookingId: string;
    let paymentId: string;
    let voucherCode: string;

    beforeAll(async () => {
      lagosId = (
        await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos', countryCode: 'NG' } })
      ).id;
    });

    it('packages, tours and add-ons', async () => {
      const pkg = await audited('adminCreatePackage', {}, (request) =>
        request.send({
          slug: 'audit-package',
          title: 'Audit package',
          summary: 'Two nights.',
          cityId: lagosId,
          nights: 2,
          cancellationPolicy: policy,
        }),
      );
      const packageId = pkg.body.id as string;
      const departure = await audited('adminCreatePackageDeparture', { id: packageId }, (request) =>
        request.send({
          startDate: inDays(50),
          endDate: inDays(52),
          capacity: 5,
          prices: { adult: ngn(100_000), child: null, infant: null },
        }),
      );
      await audited('adminUpdatePackage', { id: packageId }, (request) =>
        request.send({ status: 'published' }),
      );
      await audited('adminUpdatePackageDeparture', { id: departure.body.id as string }, (request) =>
        request.send({ capacity: 6 }),
      );

      const tour = await audited('adminCreateTour', {}, (request) =>
        request.send({
          slug: 'audit-tour',
          title: 'Audit walking tour',
          summary: 'Markets on foot.',
          cityId: lagosId,
          timeZone: 'Africa/Lagos',
          durationMinutes: 120,
          meetingPoint: { name: 'Tafawa Balewa Square', address: 'Lagos Island', notes: null },
          cancellationPolicy: policy,
        }),
      );
      const tourId = tour.body.id as string;
      const tourDeparture = await audited('adminCreateTourDeparture', { id: tourId }, (request) =>
        request.send({
          startsAtLocal: `${inDays(20)}T09:00`,
          capacity: 8,
          prices: { adult: ngn(30_000), child: null, infant: null },
        }),
      );
      tourDepartureId = tourDeparture.body.id as string;
      await audited('adminUpdateTour', { id: tourId }, (request) =>
        request.send({ status: 'published' }),
      );
      await audited('adminUpdateTourDeparture', { id: tourDepartureId }, (request) =>
        request.send({ capacity: 10 }),
      );

      const addon = await audited('adminCreateAddon', {}, (request) =>
        request.send({
          slug: 'audit-transfer',
          type: 'airport_transfer',
          title: 'Airport transfer',
          summary: 'Private car.',
          description: 'Meet and greet at arrivals.',
          countryCodes: ['NG'],
          pricingBasis: 'per_booking',
          price: ngn(25_000),
          maxTravellers: 4,
          requiredDetails: [],
          cancellationPolicy: policy,
        }),
      );
      await audited('adminUpdateAddon', { id: addon.body.id as string }, (request) =>
        request.send({ status: 'published' }),
      );
    });

    it('booking notes, contact reveal, confirmation resend and voucher redemption', async () => {
      const quote = await ctx
        .http()
        .post('/v1/inhouse-quotes')
        .send({
          kind: 'tour',
          departureId: tourDepartureId,
          travellers: { adults: 2, children: 0, infants: 0 },
        })
        .expect(201);
      const created = await ctx
        .http()
        .post('/v1/bookings')
        .set('Idempotency-Key', idempotencyKey())
        .send({
          quoteId: quote.body.quoteId,
          contact: { email: 'audit-guest@example.com', phone: '+2348012345678' },
          passengers: [traveller('Ada', 'Eze'), traveller('Obi', 'Eze')],
          termsVersion: BOOKING_TERMS_VERSION,
          acceptTerms: true,
          turnstileToken: 'e2e-turnstile',
        })
        .expect(201);
      bookingId = created.body.booking.id as string;
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
      expect(booking.body.status).toBe('CONFIRMED');
      voucherCode = booking.body.voucher.code as string;
      paymentId = (
        await ctx.prisma.payment.findFirstOrThrow({ where: { bookingId, status: 'succeeded' } })
      ).id;

      await audited('adminAddBookingNote', { bookingId }, (request) =>
        request.send({ text: 'Called the guest about the meeting point.' }),
      );
      const contact = await audited('adminRevealBookingContact', { bookingId }, none);
      expect(contact.body).toEqual({
        email: 'audit-guest@example.com',
        phone: '+2348012345678',
        redacted: false,
      });
      ctx.emails.outbox.length = 0;
      await audited('adminResendBookingConfirmation', { bookingId }, none);
      expect(ctx.emails.outbox.map((message) => message.to)).toContain('audit-guest@example.com');
      await audited('adminRedeemVoucher', {}, (request) => request.send({ code: voucherCode }));
    });

    it('refunds: create, reject, approve and resolve (maker-checker)', async () => {
      const request = () => ({
        paymentId,
        amount: ngn(1_000),
        reason: 'goodwill',
        note: 'Late start',
      });
      const rejected = await audited('adminCreateRefund', { bookingId }, (call) =>
        call.set('Idempotency-Key', idempotencyKey()).send(request()),
      );
      expect(rejected.body.status).toBe('pending_approval');
      await audited(
        'adminRejectRefund',
        { refundId: rejected.body.id as string },
        (call) => call.send({ reason: 'Already compensated' }),
        approver,
      );

      const second = await ctx
        .http()
        .post(`/v1/admin/bookings/${bookingId}/refunds`)
        .set('Idempotency-Key', idempotencyKey())
        .set(bearer(admin.accessToken))
        .send(request())
        .expect(201);
      // The provider accepts the refund but has not settled it: staff resolve it by hand.
      ctx.app.get(MockPaymentProvider).holdRefunds = true;
      try {
        await audited('adminApproveRefund', { refundId: second.body.id as string }, none, approver);
        const pending = await ctx.prisma.refund.findUniqueOrThrow({
          where: { id: second.body.id as string },
        });
        expect(pending.status).toBe('processing');
      } finally {
        ctx.app.get(MockPaymentProvider).holdRefunds = false;
      }
      await audited('adminResolveRefund', { refundId: second.body.id as string }, (call) =>
        call.send({ outcome: 'succeeded', providerRefundId: 'mock-refund-audit' }),
      );
    });
  });

  it('visa: products, rules and the officer workflow', async () => {
    const product = await audited('adminCreateVisaProduct', {}, (request) =>
      request.send({
        slug: 'audit-uk-visitor',
        title: 'UK visitor visa assistance',
        summary: 'We check and submit your application.',
        destination: 'GB',
        purposes: ['tourism'],
        processingDaysMin: 15,
        processingDaysMax: 30,
        price: ngn(80_000),
        checklist: [
          { key: 'passport', label: 'Passport', description: 'Bio page', required: true },
          { key: 'photo', label: 'Photo', description: 'Plain background', required: true },
        ],
      }),
    );
    const productId = product.body.id as string;
    await audited('adminUpdateVisaProduct', { id: productId }, (request) =>
      request.send({ status: 'published' }),
    );

    await audited('adminUpsertVisaRule', {}, (request) =>
      request.send({
        nationality: 'NG',
        destination: 'GB',
        purpose: 'tourism',
        requirement: 'visa_required',
        notes: 'Apply four weeks ahead.',
        verifiedAt: today,
      }),
    );
    const rule = await ctx.prisma.visaRule.findFirstOrThrow({
      where: { nationality: 'NG', destination: 'GB', purpose: 'tourism' },
    });
    await audited('adminDeleteVisaRule', { ruleId: rule.id }, none);

    // A confirmed application with both documents uploaded and submitted.
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
        contact: { email: 'audit-visa@example.com', phone: '+2348012345678' },
        passengers: [traveller('Chinedu', 'Okafor')],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    const visaBookingId = created.body.booking.id as string;
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${visaBookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(token)
      .send({})
      .expect(201);
    await ctx
      .http()
      .post(
        `/v1/payments/mock/${(payment.body.checkoutUrl as string).split('/').pop() ?? ''}/complete`,
      )
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const booking = await ctx.http().get(`/v1/bookings/${visaBookingId}`).set(token).expect(200);
    const applicationId = booking.body.visa.applications[0].id as string;
    const base = `/v1/bookings/${visaBookingId}/visa-applications/${applicationId}`;
    const upload = (key: string, bytes: Buffer, contentType: string) =>
      ctx
        .http()
        .put(`${base}/documents/${key}`)
        .set(token)
        .set('Content-Type', contentType)
        .set('X-File-Name', `${key}.bin`)
        .send(bytes)
        .expect(200);
    await upload('passport', PDF, 'application/pdf');
    await upload('photo', PNG, 'image/png');
    await ctx.background.drain();
    await ctx.http().post(`${base}/submit`).set(token).expect(200);
    const document = (checklistKey: string) =>
      ctx.prisma.visaDocument.findFirstOrThrow({
        where: { applicationId, checklistKey, supersededAt: null },
      });
    const passport = await document('passport');
    const photo = await document('photo');

    await audited('adminTransitionVisaApplication', { applicationId }, (request) =>
      request.send({ to: 'in_review', note: 'Checking the bank statement.' }),
    );
    await audited('adminCommentVisaApplication', { applicationId }, (request) =>
      request.send({ note: 'Called the applicant.' }),
    );
    await audited('adminCreateVisaDocumentLink', { documentId: passport.id }, none);
    await audited('adminRejectVisaDocument', { documentId: photo.id }, (request) =>
      request.send({ message: 'The photo background is patterned.' }),
    );
  });

  it('referrals held for review', async () => {
    const inviter = await signUp(ctx, 'audit-inviter@example.com');
    const mine = await ctx
      .http()
      .get('/v1/me/referrals')
      .set(bearer(inviter.accessToken))
      .expect(200);
    // The suite runs from one address; give the referrer's sessions another one.
    await ctx.prisma.session.updateMany({
      where: { userId: inviter.userId },
      data: { ipHash: 'elsewhere' },
    });
    await ctx
      .http()
      .post('/v1/auth/register')
      .send({
        email: 'audit-temp@mailinator.com',
        password: PASSWORD,
        referralCode: mine.body.code as string,
      })
      .expect(202);
    await ctx.background.drain();
    const flagged = await ctx.prisma.referral.findFirstOrThrow({
      where: { referrerId: inviter.userId },
    });
    expect(flagged.status).toBe('review');
    await audited('adminDecideReferral', { id: flagged.id }, (request) =>
      request.send({ decision: 'reject' }),
    );
  });

  it('covered every admin mutation', () => {
    const missing = MUTATIONS.map((op) => op.operationId).filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
    expect(covered.size).toBe(MUTATIONS.length);
  });
});
