import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Company accounts (ADR-078): a company with members in roles, emailed invitations that only the
 * invited address can accept, a travel policy checked on the server from the quote, approval
 * before payment for trips outside it, reports for admins and approvers, and suspension by staff.
 * Everything is scoped to the caller's own company (404 outside it).
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });

let keySequence = 0;
const idempotencyKey = (): string => `e2e-companies-${Date.now()}-${(keySequence += 1)}`;

const company = {
  name: 'Acme Logistics',
  countryCode: 'NG',
  registrationNumber: 'RC 123456',
  taxId: '',
  billingEmail: 'accounts@acme.test',
};
const person = (givenNames: string, surname: string) => ({
  type: 'adult',
  title: 'mr',
  gender: 'm',
  givenNames,
  surname,
  dateOfBirth: '1988-02-01',
  nationality: 'NG',
  document: {
    number: `A${Math.floor(Math.random() * 1e7)}`,
    issuingCountry: 'NG',
    expiryDate: inDays(3650),
  },
});

interface Member {
  userId: string;
  email: string;
  auth: Record<string, string>;
}

describe('company accounts (e2e)', () => {
  let ctx: TestContext;
  let catalog: Record<string, string>;
  let lagosId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    catalog = await staff('catalog@suskii.test', ['content_manager', 'operations']);
    lagosId = (
      await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos', countryCode: 'NG' } })
    ).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function staff(
    email: string,
    roles: Parameters<typeof grantRoles>[2],
  ): Promise<Record<string, string>> {
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
    return bearer(verified.body.accessToken as string);
  }

  /** A signed-in account whose email is verified (invitations need it). */
  async function account(email: string): Promise<Member> {
    const session = await signUp(ctx, email);
    await ctx.prisma.user.update({
      where: { id: session.userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { userId: session.userId, email, auth: bearer(session.accessToken) };
  }

  async function invite(admin: Member, email: string, role: string): Promise<string> {
    await ctx
      .http()
      .post('/v1/me/company/invitations')
      .set(admin.auth)
      .send({ email, role })
      .expect(201);
    await ctx.background.drain();
    const message = ctx.emails.outbox
      .filter((m) => m.to === email && m.template === 'company-invitation')
      .at(-1);
    const token = message?.text.match(/#invite=([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`no invitation for ${email}`);
    return token;
  }

  async function join(admin: Member, email: string, role: string): Promise<Member> {
    const member = await account(email);
    const token = await invite(admin, email, role);
    await ctx
      .http()
      .post('/v1/me/company/invitations/accept')
      .set(member.auth)
      .send({ token })
      .expect(200);
    return member;
  }

  /** A company with an admin, an approver and a traveller. */
  async function acme(): Promise<{ admin: Member; approver: Member; traveller: Member }> {
    const admin = await account('ada@acme.test');
    await ctx.http().post('/v1/me/company').set(admin.auth).send(company).expect(201);
    const approver = await join(admin, 'bola@acme.test', 'approver');
    const traveller = await join(admin, 'chidi@acme.test', 'traveller');
    return { admin, approver, traveller };
  }

  /** A published tour departing in `days` days, quoted for one adult. */
  async function tourQuote(days = 10): Promise<string> {
    const slug = `lagos-walk-${(keySequence += 1)}`;
    const created = await ctx
      .http()
      .post('/v1/admin/tours')
      .set(catalog)
      .send({
        slug,
        title: 'Lagos walking tour',
        summary: 'Markets and history on foot.',
        cityId: lagosId,
        timeZone: 'Africa/Lagos',
        durationMinutes: 180,
        meetingPoint: { name: 'Tafawa Balewa Square', address: 'Lagos Island', notes: null },
        cancellationPolicy: [{ daysBefore: 0, refundBps: 0 }],
      })
      .expect(201);
    const tourId = created.body.id as string;
    const departure = await ctx
      .http()
      .post(`/v1/admin/tours/${tourId}/departures`)
      .set(catalog)
      .send({
        startsAtLocal: `${inDays(days)}T09:00`,
        capacity: 8,
        prices: { adult: ngn(30_000), child: null, infant: null },
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/tours/${tourId}`)
      .set(catalog)
      .send({ status: 'published' })
      .expect(204);
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({
        kind: 'tour',
        departureId: departure.body.id,
        travellers: { adults: 1, children: 0, infants: 0 },
      })
      .expect(201);
    return quote.body.quoteId as string;
  }

  function book(member: Member | null, quoteId: string, companyTrip: boolean) {
    return ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .set(member?.auth ?? {})
      .send({
        quoteId,
        contact: { email: member?.email ?? 'guest@example.com', phone: '+2348012345678' },
        passengers: [person('CHIDI', 'OKAFOR')],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        company: companyTrip,
      });
  }

  function startPayment(member: Member, bookingId: string) {
    return ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(member.auth)
      .send({});
  }

  it('creates a company, invites only the invited address and keeps an admin', async () => {
    const admin = await account('ada@acme.test');
    const none = await ctx.http().get('/v1/me/company').set(admin.auth).expect(200);
    expect(none.body).toEqual({ company: null });
    const created = await ctx
      .http()
      .post('/v1/me/company')
      .set(admin.auth)
      .send(company)
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Acme Logistics',
      registrationNumber: 'RC 123456',
      taxId: null,
      status: 'active',
      myRole: 'admin',
      policy: {
        hotelNightlyCap: null,
        maxCabin: null,
        minAdvanceDays: null,
        approvalMode: 'never',
      },
    });
    // One company per person.
    const twice = await ctx.http().post('/v1/me/company').set(admin.auth).send(company);
    expect(twice.status).toBe(409);
    expect(twice.body.type).toContain('company-member-exists');

    // The invitation is emailed; the stored row has hashes and a masked address only.
    const token = await invite(admin, 'bola@acme.test', 'approver');
    const stored = await ctx.prisma.companyInvitation.findFirstOrThrow();
    expect(stored.emailHint).not.toContain('bola@');
    expect(stored.tokenHash).not.toBe(token);
    const members = await ctx.http().get('/v1/me/company/members').set(admin.auth).expect(200);
    expect(members.body.invitations).toHaveLength(1);
    expect(members.body.members).toEqual([
      expect.objectContaining({ userId: admin.userId, role: 'admin', email: 'ada@acme.test' }),
    ]);

    // A forwarded link: someone else's account cannot use it, nor an unverified one.
    const other = await account('mallory@example.com');
    const forwarded = await ctx
      .http()
      .post('/v1/me/company/invitations/accept')
      .set(other.auth)
      .send({ token });
    expect(forwarded.status).toBe(400);
    expect(forwarded.body.type).toContain('company-invitation-invalid');
    const unverified = await signUp(ctx, 'bola@acme.test');
    await ctx
      .http()
      .post('/v1/me/company/invitations/accept')
      .set(bearer(unverified.accessToken))
      .send({ token })
      .expect(400);

    await ctx.prisma.user.update({
      where: { id: unverified.userId },
      data: { emailVerifiedAt: new Date() },
    });
    const approver = { userId: unverified.userId, auth: bearer(unverified.accessToken) };
    const joined = await ctx
      .http()
      .post('/v1/me/company/invitations/accept')
      .set(approver.auth)
      .send({ token })
      .expect(200);
    expect(joined.body.myRole).toBe('approver');
    // Single use.
    await ctx
      .http()
      .post('/v1/me/company/invitations/accept')
      .set(other.auth)
      .send({ token })
      .expect(400);

    // Non-admins see names, not emails, and no invitations; they cannot manage the company.
    const seen = await ctx.http().get('/v1/me/company/members').set(approver.auth).expect(200);
    expect(seen.body.invitations).toEqual([]);
    expect(seen.body.members.every((m: { email: unknown }) => m.email === null)).toBe(true);
    const denied = await ctx.http().put('/v1/me/company/policy').set(approver.auth).send({
      hotelNightlyCap: null,
      maxCabin: null,
      minAdvanceDays: null,
      approvalMode: 'always',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.type).toContain('company-admin-required');

    // The last admin can neither step down nor leave.
    const adminMember = seen.body.members.find(
      (m: { userId: string }) => m.userId === admin.userId,
    ) as { id: string };
    const demote = await ctx
      .http()
      .put(`/v1/me/company/members/${adminMember.id}/role`)
      .set(admin.auth)
      .send({ role: 'traveller' });
    expect(demote.status).toBe(409);
    expect(demote.body.type).toContain('company-last-admin');
    await ctx.http().delete(`/v1/me/company/members/${adminMember.id}`).set(admin.auth).expect(409);
    // ...nor delete their account while others depend on them.
    const deletion = await ctx.http().get('/v1/me/deletion').set(admin.auth).expect(200);
    expect(deletion.body.blockers).toEqual(['company_admin']);

    const audit = await ctx.prisma.auditLog.findMany({
      where: { action: { startsWith: 'company.' }, targetId: created.body.id as string },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { action: true, metadata: true },
    });
    expect(audit.map((row) => row.action)).toEqual([
      'company.created',
      'company.member_invited',
      'company.member_joined',
    ]);
    expect(JSON.stringify(audit)).not.toContain('bola@acme.test');
  });

  it('holds out-of-policy trips for an approver before payment', async () => {
    const { admin, approver, traveller } = await acme();
    await ctx
      .http()
      .put('/v1/me/company/policy')
      .set(admin.auth)
      .send({
        hotelNightlyCap: ngn(80_000),
        maxCabin: 'economy',
        minAdvanceDays: 14,
        approvalMode: 'out_of_policy',
      })
      .expect(200);

    // Ten days out is too late for a 14-day policy: the trip waits for an approver.
    const created = await book(traveller, await tourQuote(10), true).expect(201);
    const bookingId = created.body.booking.id as string;
    expect(created.body.booking.company).toEqual({
      approvalStatus: 'pending',
      policyFindings: ['too_late'],
      approvalRejectReason: null,
    });
    expect(created.body.booking.paymentOptions).toBeNull();
    const blocked = await startPayment(traveller, bookingId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.type).toContain('approval-required');

    // Approvers and admins were told; the traveller was not.
    await ctx.background.drain();
    const requests = ctx.emails.outbox.filter((m) => m.template === 'company-approval-request');
    expect(requests.map((m) => m.to).sort()).toEqual(['ada@acme.test', 'bola@acme.test']);

    // The traveller sees their own trip; they cannot decide on it.
    const mine = await ctx.http().get('/v1/me/company/bookings').set(traveller.auth).expect(200);
    expect(mine.body.items).toEqual([
      expect.objectContaining({
        id: bookingId,
        bookedByMe: true,
        canDecide: false,
        travellerName: 'CHIDI OKAFOR',
        policyFindings: ['too_late'],
      }),
    ]);
    const self = await ctx
      .http()
      .post(`/v1/me/company/bookings/${bookingId}/approve`)
      .set(traveller.auth);
    expect(self.status).toBe(403);
    expect(self.body.type).toContain('company-approver-required');

    const waiting = await ctx
      .http()
      .get('/v1/me/company/bookings?approval=pending')
      .set(approver.auth)
      .expect(200);
    expect(waiting.body.items).toEqual([
      expect.objectContaining({ id: bookingId, canDecide: true, bookedByMe: false }),
    ]);
    const approved = await ctx
      .http()
      .post(`/v1/me/company/bookings/${bookingId}/approve`)
      .set(approver.auth)
      .expect(200);
    expect(approved.body).toMatchObject({ approvalStatus: 'approved', canDecide: false });
    // Decided once.
    const again = await ctx
      .http()
      .post(`/v1/me/company/bookings/${bookingId}/reject`)
      .set(admin.auth)
      .send({ reason: 'over_budget' });
    expect(again.status).toBe(409);
    expect(again.body.type).toContain('approval-not-pending');

    await ctx.background.drain();
    expect(
      ctx.emails.outbox.some(
        (m) => m.to === 'chidi@acme.test' && m.template === 'company-trip-approved',
      ),
    ).toBe(true);
    await startPayment(traveller, bookingId).expect(201);

    // An in-policy trip is not held.
    const later = await book(traveller, await tourQuote(30), true).expect(201);
    expect(later.body.booking.company).toMatchObject({
      approvalStatus: 'not_required',
      policyFindings: [],
    });
    // Personal bookings carry no company section.
    const personal = await book(traveller, await tourQuote(30), false).expect(201);
    expect(personal.body.booking.company).toBeNull();
  });

  it('cancels a rejected trip, and never lets an approver decide their own', async () => {
    const { admin, approver } = await acme();
    await ctx
      .http()
      .put('/v1/me/company/policy')
      .set(admin.auth)
      .send({ hotelNightlyCap: null, maxCabin: null, minAdvanceDays: null, approvalMode: 'always' })
      .expect(200);

    const own = await book(approver, await tourQuote(), true).expect(201);
    const ownId = own.body.booking.id as string;
    const selfApproval = await ctx
      .http()
      .post(`/v1/me/company/bookings/${ownId}/approve`)
      .set(approver.auth);
    expect(selfApproval.status).toBe(403);
    expect(selfApproval.body.type).toContain('approval-own-trip');

    const rejected = await ctx
      .http()
      .post(`/v1/me/company/bookings/${ownId}/reject`)
      .set(admin.auth)
      .send({ reason: 'cheaper_option' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      status: 'CANCELLED',
      approvalStatus: 'rejected',
      approvalRejectReason: 'cheaper_option',
    });
    const booking = await ctx.http().get(`/v1/bookings/${ownId}`).set(approver.auth).expect(200);
    expect(booking.body.status).toBe('CANCELLED');
    await ctx
      .http()
      .post(`/v1/me/company/bookings/${ownId}/reject`)
      .set(admin.auth)
      .send({ reason: 'free text' })
      .expect(400);
    const history = await ctx.prisma.bookingStatusHistory.findFirstOrThrow({
      where: { bookingId: ownId, toStatus: 'CANCELLED' },
    });
    expect(history.reason).toBe('company_rejected');
  });

  it("keeps every company's trips and members to itself", async () => {
    const { admin, traveller } = await acme();
    const trip = await book(traveller, await tourQuote(), true).expect(201);
    const tripId = trip.body.booking.id as string;
    const members = await ctx.http().get('/v1/me/company/members').set(admin.auth).expect(200);
    const travellerMember = members.body.members.find(
      (m: { userId: string }) => m.userId === traveller.userId,
    ) as { id: string };

    // Another company's admin gets 404 for every id from Acme.
    const rival = await account('zara@rival.test');
    await ctx
      .http()
      .post('/v1/me/company')
      .set(rival.auth)
      .send({ ...company, name: 'Rival Ltd', billingEmail: 'ap@rival.test' })
      .expect(201);
    await ctx.http().post(`/v1/me/company/bookings/${tripId}/approve`).set(rival.auth).expect(404);
    await ctx
      .http()
      .put(`/v1/me/company/members/${travellerMember.id}/role`)
      .set(rival.auth)
      .send({ role: 'admin' })
      .expect(404);
    await ctx
      .http()
      .delete(`/v1/me/company/members/${travellerMember.id}`)
      .set(rival.auth)
      .expect(404);
    const rivalTrips = await ctx.http().get('/v1/me/company/bookings').set(rival.auth).expect(200);
    expect(rivalTrips.body.items).toEqual([]);

    // Someone in no company gets 404 everywhere.
    const loner = await account('sam@example.com');
    await ctx.http().get('/v1/me/company/bookings').set(loner.auth).expect(404);
    await ctx.http().get('/v1/me/company/spend').set(loner.auth).expect(404);
    const noCompany = await book(loner, await tourQuote(), true);
    expect(noCompany.status).toBe(404);
    // Guests cannot book for a company.
    const guest = await book(null, await tourQuote(), true);
    expect(guest.status).toBe(422);
    expect(guest.body.type).toContain('company-booking-unavailable');

    // Travellers see their own trips only, and no reports.
    const colleague = await join(admin, 'dayo@acme.test', 'booker');
    const theirs = await ctx.http().get('/v1/me/company/bookings').set(colleague.auth).expect(200);
    expect(theirs.body.items).toEqual([]);
    const report = await ctx.http().get('/v1/me/company/spend').set(colleague.auth);
    expect(report.status).toBe(403);
    expect(report.body.type).toContain('company-approver-required');
    await ctx.http().get('/v1/me/company/export').set(colleague.auth).expect(403);

    // A member who leaves keeps their account; company trips stay with the company.
    await ctx
      .http()
      .delete(`/v1/me/company/members/${travellerMember.id}`)
      .set(traveller.auth)
      .expect(204);
    const left = await ctx.http().get('/v1/me/company').set(traveller.auth).expect(200);
    expect(left.body.company).toBeNull();
    const kept = await ctx.http().get('/v1/me/company/bookings').set(admin.auth).expect(200);
    expect(kept.body.items.map((item: { id: string }) => item.id)).toEqual([tripId]);
  });

  it('reports committed spend and exports trips as CSV', async () => {
    const { admin, traveller } = await acme();
    const paid = await book(traveller, await tourQuote(), true).expect(201);
    const paidId = paid.body.booking.id as string;
    await book(traveller, await tourQuote(), true).expect(201);
    // One paid trip (the other waits for payment and is not spend).
    await ctx.prisma.booking.update({ where: { id: paidId }, data: { status: 'CONFIRMED' } });

    const spend = await ctx.http().get('/v1/me/company/spend').set(admin.auth).expect(200);
    const total = paid.body.booking.price.total as { amountMinor: number; currency: string };
    expect(spend.body.totals).toEqual([{ total, bookings: 1 }]);
    expect(spend.body.byMonth).toEqual([{ month: today.slice(0, 7), total, bookings: 1 }]);
    expect(spend.body.byTraveller).toEqual([{ travellerName: 'CHIDI OKAFOR', total, bookings: 1 }]);
    await ctx
      .http()
      .get(`/v1/me/company/spend?from=${inDays(1)}&to=${today}`)
      .set(admin.auth)
      .expect(400);

    const csv = await ctx.http().get('/v1/me/company/export').set(admin.auth).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment;');
    const lines = csv.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'reference,booked_at,product,starts_on,ends_on,traveller,booked_by,status,approval,policy_findings,currency,total_minor',
    );
    expect(lines).toHaveLength(3);
    expect(csv.text).not.toContain('chidi@acme.test');
    expect(csv.text).not.toContain('+2348012345678');
  });

  it('lets staff suspend a company, which stops company bookings', async () => {
    const { traveller } = await acme();
    const superAdmin = await staff('root@suskii.test', ['super_admin']);
    const listed = await ctx.http().get('/v1/admin/companies').set(superAdmin).expect(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({ name: 'Acme Logistics', members: 3, status: 'active' }),
    ]);
    const companyId = listed.body.items[0].id as string;
    const detail = await ctx
      .http()
      .get(`/v1/admin/companies/${companyId}`)
      .set(superAdmin)
      .expect(200);
    expect(detail.body.memberList).toHaveLength(3);

    // Support may look but not suspend.
    const support = await staff('help@suskii.test', ['support']);
    await ctx.http().get('/v1/admin/companies').set(support).expect(200);
    await ctx.http().post(`/v1/admin/companies/${companyId}/suspend`).set(support).expect(403);

    await ctx.http().post(`/v1/admin/companies/${companyId}/suspend`).set(superAdmin).expect(200);
    const refused = await book(traveller, await tourQuote(), true);
    expect(refused.status).toBe(409);
    expect(refused.body.type).toContain('company-suspended');
    // Their own trips still work.
    await book(traveller, await tourQuote(), false).expect(201);

    await ctx.http().post(`/v1/admin/companies/${companyId}/reinstate`).set(superAdmin).expect(200);
    await book(traveller, await tourQuote(), true).expect(201);
    const actions = await ctx.prisma.auditLog.findMany({
      where: { action: { in: ['company.suspended', 'company.reinstated'] } },
      select: { action: true, targetId: true },
    });
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: 'company.suspended', targetId: companyId },
        { action: 'company.reinstated', targetId: companyId },
      ]),
    );
  });
});
