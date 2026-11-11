import {
  AGENT_APPROVAL_OPEN_LIMIT,
  agentScopesFor,
  type AgentRunEvent,
  type Role,
} from '@suskii/shared';

import { AgentGrants } from '../src/agent/agent-grants';
import { AgentPause } from '../src/agent/agent-pause';
import { AgentSettingsService } from '../src/agent/agent-settings.service';
import { AgentApprovalsService } from '../src/agent/approvals/agent-approvals.service';
import { MockAgentClient } from '../src/agent/chat/agent-client';
import { PricingService } from '../src/pricing/pricing.service';

import { nextKey, staffSession } from './helpers/cars';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { localIn, paidRental, rentalVehicle } from './helpers/rentals';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The staff agents and the approvals queue (ADR-107), end to end with the agent service played
 * by a script: a staff member reaches only the agents their own permissions open, an agent
 * reads only what that person may read, and what it prepares changes nothing until someone
 * else, who may do that thing themselves, approves it.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghi';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijk';

interface Staff {
  userId: string;
  headers: Record<string, string>;
  roles: Role[];
}
interface Answer<T = Record<string, unknown>> {
  status: 'ok' | 'denied' | 'error' | 'timeout';
  reason: string | null;
  result: (T & { problems?: string[] }) | null;
}
interface Proposal {
  waitsForApproval: boolean;
  wasAlreadyWaiting: boolean;
  approvalId: string | null;
}
interface Approval {
  id: string;
  kind: string;
  status: string;
  agent: string;
  requestedBy: string;
  mayDecide: boolean;
  subject: { type: string; id: string } | null;
  payload: Record<string, unknown>;
  reason: string | null;
  decidedBy: string | null;
  result: { type: string; id: string } | null;
}
interface Wire {
  amountMinor: number;
  currency: string;
}

const USAGE = {
  role: 'specialist' as const,
  provider: 'mock',
  model: 'mock-specialist',
  calls: 1,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
const said = (agent: 'finance_prep' | 'operations', text: string): AgentRunEvent =>
  ({
    type: 'end',
    outcome: 'answered',
    agent,
    agents: [agent],
    answer: { kind: 'text', text, cards: [], sources: [] },
    notice: null,
    confirmationId: null,
    prompts: ['staff_router@1', `${agent}@1`],
    steps: 2,
    usage: [USAGE],
  }) satisfies AgentRunEvent;

describe('staff agents and the approvals queue (e2e)', () => {
  let ctx: TestContext;
  let mock: MockAgentClient;
  let grants: AgentGrants;
  let ada: TokenSession;
  let root: Staff;
  let ops: Staff;
  let fin: Staff;
  let help: Staff;
  let content: Staff;
  let bookingId: string;
  let paymentId: string;
  let paid: Wire;

  const persona = async (email: string, roles: Role[]): Promise<Staff> => ({
    ...(await staffSession(ctx, email, roles)),
    roles,
  });

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      AGENT_RUN_MAX_TOOL_CALLS: 60,
    });
    mock = ctx.app.get(MockAgentClient);
    grants = ctx.app.get(AgentGrants);
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    root = await persona('staff-root@suskii.test', ['super_admin']);
    ops = await persona('staff-ops@suskii.test', ['operations']);
    fin = await persona('staff-fin@suskii.test', ['finance']);
    help = await persona('staff-help@suskii.test', ['support']);
    content = await persona('staff-content@suskii.test', ['content_manager']);
    ada = await signUp(ctx, 'staff-ada@example.com');

    // One paid booking of a traveller's, for the finance tools to read and prepare a refund of.
    const car = await rentalVehicle(ctx, root.headers);
    const rental = await paidRental(ctx, bearer(ada.accessToken), {
      vehicleId: car.id,
      pickupAtLocal: localIn(72),
      returnAtLocal: localIn(120),
    });
    bookingId = rental.bookingId;
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { bookingId, status: 'succeeded' },
    });
    paymentId = payment.id;
    paid = { amountMinor: Number(payment.amountMinor), currency: payment.currency };
  });
  beforeEach(async () => {
    await ctx.background.drain();
    mock.use(null);
    await ctx.app.get(AgentPause).resume();
    await ctx.prisma.agentApproval.deleteMany();
    await ctx.prisma.refund.deleteMany({ where: { bookingId } });
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  // --- helpers ---------------------------------------------------------------------------------

  const scopesOf = (staff: Staff) =>
    agentScopesFor({ userId: staff.userId, roles: staff.roles, channel: 'console' });

  /** A grant as the API seals one for a staff member's run in the console. */
  const grantFor = async (staff: Staff, conversationId: string | null = null): Promise<string> => {
    const run = await ctx.prisma.agentRun.create({
      data: {
        audience: 'staff',
        channel: 'console',
        agent: 'executive',
        trigger: 'message',
        status: 'running',
        conversationId,
      },
    });
    return grants.issue({
      runId: run.id,
      conversationId,
      userId: staff.userId,
      roles: staff.roles,
      audience: 'staff',
      channel: 'console',
      scopes: scopesOf(staff),
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
    });
  };

  const call = async <T = Record<string, unknown>>(
    tool: string,
    agent: string,
    args: Record<string, unknown>,
    grant: string,
  ): Promise<Answer<T>> => {
    const response = await ctx
      .http()
      .post(`/v1/internal/agent-tools/${tool}`)
      .set('authorization', `Bearer ${TOOLS_TOKEN}`)
      .send({ grant, agent, arguments: args });
    expect(response.status).toBe(200);
    return response.body as Answer<T>;
  };

  const refundDraft = (over: Record<string, unknown> = {}) => ({
    bookingId,
    paymentId,
    amountMinor: 100_000,
    reason: 'goodwill',
    ...over,
  });
  const promoDraft = (code: string, over: Record<string, unknown> = {}) => ({
    code,
    gives: 'percentage',
    value: 1000,
    products: ['flights'],
    ...over,
  });

  /** A proposal an agent prepared for a staff member, through the gateway. */
  const drafted = async (
    staff: Staff,
    tool: 'finance.draft_refund_request' | 'marketing.draft_promo',
    args: Record<string, unknown>,
  ): Promise<string> => {
    const agent = tool.startsWith('finance') ? 'finance_prep' : 'marketing';
    const answer = await call<Proposal>(tool, agent, args, await grantFor(staff));
    expect(answer).toMatchObject({ status: 'ok', result: { waitsForApproval: true } });
    return answer.result?.approvalId ?? '';
  };

  const queue = async (staff: Staff, status = 'pending') => {
    const response = await ctx
      .http()
      .get(`/v1/admin/ai/approvals?status=${status}`)
      .set(staff.headers);
    return {
      status: response.status,
      approvals: (response.body as { approvals?: Approval[] }).approvals ?? [],
      alsoWaiting: (response.body as { alsoWaiting?: Record<string, number> }).alsoWaiting,
    };
  };
  const decide = (
    staff: Staff,
    id: string,
    decision: 'approve' | 'reject',
    body: Record<string, unknown> = decision === 'reject' ? { reason: 'not_needed' } : {},
  ) => ctx.http().post(`/v1/admin/ai/approvals/${id}/${decision}`).set(staff.headers).send(body);

  const converse = async (staff: Staff): Promise<string> =>
    (
      (
        await ctx
          .http()
          .post('/v1/admin/ai/conversations')
          .set(staff.headers)
          .send({ locale: 'en-NG' })
          .expect(201)
      ).body as { id: string }
    ).id;
  const ask = (staff: Staff, conversationId: string, text: string) =>
    ctx.http().post('/v1/admin/ai/chat').set(staff.headers).send({ conversationId, text });

  // --- who reaches which agent -----------------------------------------------------------------

  describe('the console chat', () => {
    it('is for staff who may read the assistant, and never for a traveller', async () => {
      const traveller = bearer(ada.accessToken);
      for (const headers of [traveller, content.headers]) {
        await ctx
          .http()
          .post('/v1/admin/ai/conversations')
          .set(headers)
          .send({ locale: 'en-NG' })
          .expect(403);
        await ctx.http().get('/v1/admin/ai/approvals').set(headers).expect(403);
      }
      await ctx.http().post('/v1/admin/ai/conversations').send({ locale: 'en-NG' }).expect(401);
      // The console says which language the person reads: without it nothing is started.
      await ctx.http().post('/v1/admin/ai/conversations').set(ops.headers).send({}).expect(400);
    });

    it("offers a staff member the agents their own permissions open, and seals those scopes into the run's grant", async () => {
      const expected: [Staff, string[], string[]][] = [
        [
          root,
          [
            'price_intel',
            'operations',
            'finance_prep',
            'marketing',
            'business_intelligence',
            'executive',
          ],
          ['catalog', 'search', 'ops', 'finance', 'marketing', 'reports', 'datasources'],
        ],
        [
          ops,
          ['operations', 'finance_prep', 'marketing', 'business_intelligence', 'executive'],
          ['catalog', 'search', 'ops', 'finance', 'marketing', 'reports'],
        ],
        [
          fin,
          ['finance_prep', 'business_intelligence', 'executive'],
          ['catalog', 'search', 'finance', 'reports'],
        ],
        // Support may ask for refunds and reads no reports: one agent, one staff scope.
        [help, ['finance_prep'], ['catalog', 'search', 'finance']],
      ];
      for (const [staff, agents, scopes] of expected) {
        mock.use(null);
        const conversationId = await converse(staff);
        const sent = await ask(staff, conversationId, 'What is waiting today?').expect(202);
        await ctx.background.drain();
        const request = mock.requests[0]!;
        expect(request.context).toMatchObject({
          audience: 'staff',
          channel: 'console',
          agents,
          signedIn: true,
        });
        const grant = grants.open(request.grant);
        expect(grant).toMatchObject({
          userId: staff.userId,
          audience: 'staff',
          channel: 'console',
          conversationId,
          runId: (sent.body as { runId: string }).runId,
        });
        expect([...(grant?.scopes ?? [])].sort()).toEqual([...scopes].sort());

        const read = await ctx
          .http()
          .get(`/v1/admin/ai/conversations/${conversationId}`)
          .set(staff.headers)
          .expect(200);
        const messages = (read.body as { messages: { role: string; agent: string | null }[] })
          .messages;
        // The mock answers as the first agent on offer.
        expect(messages.map((message) => [message.role, message.agent])).toEqual([
          ['user', null],
          ['assistant', agents[0]],
        ]);
      }
    });

    it("keeps a staff conversation to the person who started it, and apart from travellers' chats", async () => {
      const conversationId = await converse(ops);
      const sent = await ask(ops, conversationId, 'How many quotes wait?').expect(202);
      await ctx.background.drain();
      const runId = (sent.body as { runId: string }).runId;

      // Another staff member, even a super admin, gets 404 everywhere.
      await ctx
        .http()
        .get(`/v1/admin/ai/conversations/${conversationId}`)
        .set(root.headers)
        .expect(404);
      await ask(root, conversationId, 'Let me in').expect(404);
      await ctx.http().get(`/v1/admin/ai/runs/${runId}`).set(root.headers).expect(404);
      // Its owner reads the run's events.
      const events = await ctx
        .http()
        .get(`/v1/admin/ai/runs/${runId}`)
        .set(ops.headers)
        .expect(200);
      expect(events.body).toMatchObject({ runId, done: true, status: 'succeeded' });

      // The travellers' routes never open a staff conversation, even for its owner...
      await ctx
        .http()
        .get(`/v1/agent/conversations/${conversationId}`)
        .set(ops.headers)
        .expect(404);
      await ctx
        .http()
        .post('/v1/agent/chat')
        .set(ops.headers)
        .send({ conversationId, text: 'Through the other door' })
        .expect(404);
      await ctx.http().get(`/v1/agent/runs/${runId}`).set(ops.headers).expect(404);
      // ...and the console never opens a traveller's.
      const theirs = (
        (
          await ctx
            .http()
            .post('/v1/agent/conversations')
            .set(bearer(ada.accessToken))
            .send({})
            .expect(201)
        ).body as { conversation: { id: string } }
      ).conversation.id;
      await ctx.http().get(`/v1/admin/ai/conversations/${theirs}`).set(root.headers).expect(404);
      await ask(root, theirs, 'Reading over a shoulder').expect(404);
    });

    it('records that a question was asked, never its words, and stops while paused', async () => {
      const conversationId = await converse(fin);
      const words = 'Is the refund for the Ikeja rental through yet?';
      const sent = await ask(fin, conversationId, words).expect(202);
      await ctx.background.drain();
      const logged = await ctx.prisma.auditLog.findMany({
        where: {
          actorUserId: fin.userId,
          action: { in: ['agent.staff_conversation_started', 'agent.staff_message_sent'] },
          targetId: conversationId,
        },
        orderBy: { occurredAt: 'asc' },
      });
      expect(logged.map((row) => row.action)).toEqual([
        'agent.staff_conversation_started',
        'agent.staff_message_sent',
      ]);
      expect(logged[1]?.metadata).toEqual({ runId: (sent.body as { runId: string }).runId });
      expect(JSON.stringify(logged)).not.toContain('Ikeja');
      // The message itself is sealed at rest, as a traveller's is.
      const stored = await ctx.prisma.agentMessage.findMany({ where: { conversationId } });
      expect(JSON.stringify(stored)).not.toContain('Ikeja');

      await ctx.app.get(AgentPause).pause('maintenance');
      const paused = await ask(fin, conversationId, 'Still there?');
      expect([paused.status, (paused.body as { type: string }).type]).toEqual([
        503,
        expect.stringContaining('agent-paused'),
      ]);
    });
  });

  // --- what a staff agent reads ------------------------------------------------------------------

  describe('staff tools', () => {
    it('are refused on a grant whose person may not read that part of the platform', async () => {
      const customer = await (async () => {
        const run = await ctx.prisma.agentRun.create({
          data: {
            audience: 'customer',
            channel: 'web',
            agent: 'concierge',
            trigger: 'message',
            status: 'running',
          },
        });
        return grants.issue({
          runId: run.id,
          conversationId: null,
          userId: ada.userId,
          roles: ['customer'],
          audience: 'customer',
          channel: 'web',
          scopes: ['catalog', 'search', 'quotes', 'support', 'account'],
          locale: 'en-NG',
          currency: 'NGN',
          country: 'NG',
        });
      })();
      // A traveller's grant names no staff agent, and a traveller's agent owns no staff tool.
      expect((await call('ops.queues', 'operations', {}, customer)).reason).toBe('agent');
      expect((await call('ops.queues', 'concierge', {}, customer)).reason).toBe('agent');
      expect(
        (await call('finance.booking_payments', 'bookings', { bookingId }, customer)).reason,
      ).toBe('agent');

      // Support may ask for refunds but manages no bookings, reports or promo codes.
      const support = await grantFor(help);
      expect((await call('ops.queues', 'operations', {}, support)).reason).toBe('scope');
      expect((await call('reports.sales', 'business_intelligence', {}, support)).reason).toBe(
        'scope',
      );
      expect((await call('marketing.promos', 'marketing', {}, support)).reason).toBe('scope');
      expect(
        (await call('marketing.draft_promo', 'marketing', promoDraft('HELPDESK10'), support))
          .reason,
      ).toBe('scope');
      // Only the people who manage web price sources read how they stand.
      expect((await call('sources.overview', 'price_intel', {}, await grantFor(ops))).reason).toBe(
        'scope',
      );
      // An agent keeps to its own tools even when the person could read more.
      expect(
        (await call('finance.booking_payments', 'operations', { bookingId }, await grantFor(root)))
          .reason,
      ).toBe('agent');
      expect(await ctx.prisma.agentApproval.count()).toBe(0);
    });

    it('answer operations, reports, finance, marketing and price intelligence in counts and amounts', async () => {
      // Something for the queues to count: a traveller's request for a confirmed price.
      await ctx
        .http()
        .post('/v1/quotes/assisted')
        .set(bearer(ada.accessToken))
        .set('Idempotency-Key', nextKey('e2e-staff-quote'))
        .send({
          product: 'hotel',
          title: 'A room by the lagoon',
          request: {
            destination: 'Lagos',
            startDate: localIn(24 * 30).slice(0, 10),
            endDate: localIn(24 * 32).slice(0, 10),
            adults: 2,
          },
          currency: 'NGN',
        })
        .expect(201);

      const grant = await grantFor(root);
      const queues = await call<Record<string, number>>('ops.queues', 'operations', {}, grant);
      expect(queues).toMatchObject({
        status: 'ok',
        result: {
          assistedQuotesToVerify: 1,
          assistedBookingsToBookByHand: 0,
          refundsAwaitingApproval: 0,
          airlineChangesOpen: 0,
        },
      });

      const sales = await call<{
        bookingsMade: number;
        byProduct: { product: string; bookings: number }[];
        money: { currency: string; received: Wire; refundedSoFar: Wire }[];
      }>('reports.sales', 'business_intelligence', {}, grant);
      expect(sales.status).toBe('ok');
      expect(sales.result?.bookingsMade).toBe(1);
      expect(sales.result?.byProduct).toEqual([{ product: 'rentals', bookings: 1 }]);
      expect(sales.result?.money).toEqual([
        expect.objectContaining({
          currency: 'NGN',
          received: paid,
          refundedSoFar: { amountMinor: 0, currency: 'NGN' },
        }),
      ]);
      // A period that cannot be is said in a code, not as an error.
      const backwards = await call(
        'reports.sales',
        'executive',
        { from: '2026-06-01', to: '2026-01-01' },
        grant,
      );
      expect(backwards.status).toBe('ok');
      expect(backwards.result?.problems?.length).toBeGreaterThan(0);

      const payments = await call<{
        bookingStatus: string;
        product: string;
        payments: { paymentId: string; amount: Wire; stillRefundable: Wire }[];
      }>('finance.booking_payments', 'finance_prep', { bookingId }, grant);
      expect(payments.result).toMatchObject({
        bookingStatus: 'confirmed',
        product: 'rentals',
        payments: [{ paymentId, amount: paid, stillRefundable: paid }],
      });
      expect(
        (
          await call(
            'finance.booking_payments',
            'finance_prep',
            { bookingId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' },
            grant,
          )
        ).reason,
      ).toBe('not_found');

      const finance = await call<Record<string, unknown>>(
        'finance.overview',
        'finance_prep',
        {},
        grant,
      );
      expect(finance.result).toMatchObject({
        refundsAwaitingApproval: 0,
        refundRequestsPreparedAndWaiting: 0,
        openDiscrepancies: [],
      });

      const promos = await call<{ found: number }>('marketing.promos', 'marketing', {}, grant);
      expect(promos).toMatchObject({ status: 'ok', result: { found: 0, promos: [] } });

      const sources = await call<{ switchedOn: boolean; vendors: unknown[] }>(
        'sources.overview',
        'price_intel',
        {},
        grant,
      );
      expect(sources.status).toBe('ok');
      expect(sources.result?.switchedOn).toBe(true);

      // Nothing a staff tool returns names the traveller, their contact or their reference.
      const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      const everything = JSON.stringify([queues, sales, payments, finance, promos, sources]);
      for (const secret of [booking.reference, 'traveller@example.com', 'Ngozi', 'Eze', '+234']) {
        expect(everything).not.toContain(secret);
      }
    });

    it('prepare a refund request or a promo code as a row in the queue, and change nothing', async () => {
      const grant = await grantFor(ops);
      // More than the payment holds: said in a code, nothing queued.
      const tooMuch = await call<Proposal>(
        'finance.draft_refund_request',
        'finance_prep',
        refundDraft({ amountMinor: paid.amountMinor + 1 }),
        grant,
      );
      expect(tooMuch.result).toMatchObject({
        problems: ['amount_above_refundable'],
        waitsForApproval: false,
        approvalId: null,
      });
      // A payment of another booking is not this booking's.
      expect(
        (
          await call(
            'finance.draft_refund_request',
            'finance_prep',
            refundDraft({ bookingId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }),
            grant,
          )
        ).reason,
      ).toBe('not_found');
      // A reason is one of the staff refund reasons, not a sentence.
      expect(
        (
          await call(
            'finance.draft_refund_request',
            'finance_prep',
            refundDraft({ reason: 'the traveller sent a screenshot of the payment' }),
            grant,
          )
        ).reason,
      ).toBe('invalid');
      expect(await ctx.prisma.agentApproval.count()).toBe(0);

      const first = await call<Proposal>(
        'finance.draft_refund_request',
        'finance_prep',
        refundDraft(),
        grant,
      );
      expect(first.result).toMatchObject({
        problems: [],
        waitsForApproval: true,
        wasAlreadyWaiting: false,
      });
      // Asked twice, it is one proposal.
      const again = await call<Proposal>(
        'finance.draft_refund_request',
        'finance_prep',
        refundDraft(),
        grant,
      );
      expect(again.result).toMatchObject({
        waitsForApproval: true,
        wasAlreadyWaiting: true,
        approvalId: first.result?.approvalId,
      });

      const promo = await call<Proposal>(
        'marketing.draft_promo',
        'marketing',
        // Whatever the draft says, a promo code is created switched off.
        promoDraft('DECEMBER10', { active: true }),
        grant,
      );
      expect(promo.result).toMatchObject({ waitsForApproval: true });
      const unusable = await call<Proposal>(
        'marketing.draft_promo',
        'marketing',
        promoDraft('TOOMUCH', { value: 20_000 }),
        grant,
      );
      expect(unusable.result?.waitsForApproval).toBe(false);
      expect(unusable.result?.problems?.length).toBeGreaterThan(0);

      const rows = await ctx.prisma.agentApproval.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows.map((row) => [row.kind, row.status, row.agent, row.requestedBy])).toEqual([
        ['refund_request', 'pending', 'finance_prep', ops.userId],
        ['promo_code', 'pending', 'marketing', ops.userId],
      ]);
      expect(rows[0]?.payload).toMatchObject({
        bookingId,
        paymentId,
        amount: { amountMinor: 100_000, currency: 'NGN' },
        reason: 'goodwill',
        cancelBooking: false,
      });
      expect(rows[1]?.payload).toMatchObject({ code: 'DECEMBER10', active: false });
      // Nothing was requested, refunded or created.
      expect(await ctx.prisma.refund.count({ where: { bookingId } })).toBe(0);
      expect(await ctx.prisma.promoCode.count({ where: { code: 'DECEMBER10' } })).toBe(0);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'agent.approval_proposed', actorUserId: ops.userId },
        }),
      ).toBeGreaterThanOrEqual(2);
    });

    it('prepare nothing for an agent set to advice only, and no more than a person can have waiting', async () => {
      const settings = ctx.app.get(AgentSettingsService);
      const actor = { userId: root.userId, context: { ip: '127.0.0.1', userAgent: 'e2e' } };
      await settings.setAutonomy({ subject: 'agent', name: 'marketing', level: 'manual' }, actor);
      try {
        const refused = await call(
          'marketing.draft_promo',
          'marketing',
          promoDraft('ADVICEONLY'),
          await grantFor(ops),
        );
        expect([refused.status, refused.reason]).toEqual(['denied', 'autonomy']);
        // Reading still works at advice only.
        expect((await call('marketing.promos', 'marketing', {}, await grantFor(ops))).status).toBe(
          'ok',
        );
      } finally {
        await settings.setAutonomy(
          { subject: 'agent', name: 'marketing', level: 'supervised' },
          actor,
        );
      }
      expect(await ctx.prisma.agentApproval.count()).toBe(0);

      const grant = await grantFor(ops);
      for (let index = 0; index < AGENT_APPROVAL_OPEN_LIMIT; index += 1) {
        const made = await call<Proposal>(
          'marketing.draft_promo',
          'marketing',
          promoDraft(`QUEUE${String(index).padStart(3, '0')}`),
          grant,
        );
        expect(made.result?.waitsForApproval).toBe(true);
      }
      const over = await call<Proposal>(
        'marketing.draft_promo',
        'marketing',
        promoDraft('ONETOOMANY'),
        grant,
      );
      expect(over.result).toMatchObject({
        problems: ['too_many_waiting'],
        waitsForApproval: false,
      });
      // The limit is a person's: someone else's agent can still prepare one.
      await drafted(root, 'marketing.draft_promo', promoDraft('ANOTHERS10'));
    });
  });

  // --- who decides -------------------------------------------------------------------------------

  describe('the approvals queue', () => {
    it('shows what would be done, and lets only someone else who may do it decide', async () => {
      const refundId = await drafted(ops, 'finance.draft_refund_request', refundDraft());
      const promoId = await drafted(ops, 'marketing.draft_promo', promoDraft('NEWYEAR10'));

      const mine = await queue(ops);
      expect(mine.status).toBe(200);
      expect(mine.approvals.map((row) => [row.id, row.kind, row.mayDecide])).toEqual([
        [refundId, 'refund_request', false],
        [promoId, 'promo_code', false],
      ]);
      expect(mine.approvals[0]).toMatchObject({
        agent: 'finance_prep',
        requestedBy: ops.userId,
        subject: { type: 'booking', id: bookingId },
        payload: { paymentId, amount: { amountMinor: 100_000, currency: 'NGN' } },
      });
      expect(mine.alsoWaiting).toEqual({
        assistedQuotesToVerify: expect.any(Number),
        assistedBookingsToBook: 0,
      });
      // Finance asks for refunds and manages no promo codes.
      const theirs = await queue(fin);
      expect(theirs.approvals.map((row) => [row.kind, row.mayDecide])).toEqual([
        ['refund_request', true],
        ['promo_code', false],
      ]);

      // The person who asked decides neither way.
      for (const decision of ['approve', 'reject'] as const) {
        const own = await decide(ops, refundId, decision);
        expect([own.status, (own.body as { type: string }).type]).toEqual([
          403,
          expect.stringContaining('own-approval'),
        ]);
      }
      // `ai:approve` alone decides nothing: the kind's own permission is needed too.
      await decide(fin, promoId, 'approve').expect(403);
      await decide(fin, promoId, 'reject').expect(403);
      await decide(help, promoId, 'approve').expect(403);
      // Without `ai:approve` there is no route at all.
      await decide(content, promoId, 'approve').expect(403);
      await ctx
        .http()
        .post(`/v1/admin/ai/approvals/${promoId}/approve`)
        .set(bearer(ada.accessToken))
        .send({})
        .expect(403);
      await decide(root, '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 'approve').expect(404);

      const rows = await ctx.prisma.agentApproval.findMany();
      expect(rows.map((row) => row.status)).toEqual(['pending', 'pending']);
      expect(await ctx.prisma.refund.count({ where: { bookingId } })).toBe(0);
    });

    it("turns an approved refund draft into the approver's ordinary refund request, which still waits for its own second approver", async () => {
      const id = await drafted(ops, 'finance.draft_refund_request', refundDraft());
      const approved = await decide(fin, id, 'approve').expect(200);
      const body = approved.body as Approval;
      expect(body).toMatchObject({
        status: 'approved',
        decidedBy: fin.userId,
        mayDecide: false,
        result: { type: 'refund' },
      });
      const refund = await ctx.prisma.refund.findUniqueOrThrow({
        where: { id: body.result?.id ?? '' },
      });
      // An ordinary staff refund: requested by the approver, not yet approved, nothing sent.
      expect(refund).toMatchObject({
        bookingId,
        paymentId,
        amountMinor: 100_000n,
        currency: 'NGN',
        status: 'pending_approval',
        requestedByUserId: fin.userId,
        approvedByUserId: null,
      });
      // Maker-checker holds: the person who approved the draft cannot approve the refund.
      await ctx
        .http()
        .post(`/v1/admin/refunds/${refund.id}/approve`)
        .set(fin.headers)
        .send({})
        .expect(403);
      const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('CONFIRMED');

      // Decided once.
      for (const decision of ['approve', 'reject'] as const) {
        const second = await decide(root, id, decision);
        expect([second.status, (second.body as { type: string }).type]).toEqual([
          409,
          expect.stringContaining('approval-decided'),
        ]);
      }
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'agent.approval_approved', targetId: id },
      });
      expect(audit).toMatchObject({ actorUserId: fin.userId });
      expect(audit.metadata).toMatchObject({
        kind: 'refund_request',
        carriedOut: true,
        resultType: 'refund',
        resultId: refund.id,
      });
    });

    it('creates an approved promo code switched off, and does nothing for a rejected one', async () => {
      const id = await drafted(
        root,
        'marketing.draft_promo',
        promoDraft('HARMATTAN15', { value: 1500 }),
      );
      const approved = (await decide(ops, id, 'approve').expect(200)).body as Approval;
      expect(approved).toMatchObject({ status: 'approved', result: { type: 'promo_code' } });
      const promo = await ctx.prisma.promoCode.findUniqueOrThrow({
        where: { id: approved.result?.id ?? '' },
      });
      expect(promo).toMatchObject({ code: 'HARMATTAN15', value: 1500n, active: false });

      const other = await drafted(root, 'marketing.draft_promo', promoDraft('RAINY20'));
      const rejected = (await decide(ops, other, 'reject', { reason: 'wrong_details' }).expect(200))
        .body as Approval;
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: 'wrong_details',
        decidedBy: ops.userId,
        result: null,
      });
      // A reason is a code.
      const third = await drafted(root, 'marketing.draft_promo', promoDraft('WINDY25'));
      await decide(ops, third, 'reject', { reason: 'I do not like it' }).expect(400);
      expect(
        await ctx.prisma.promoCode.count({ where: { code: { in: ['RAINY20', 'WINDY25'] } } }),
      ).toBe(0);
      expect((await queue(ops, 'rejected')).approvals.map((row) => row.id)).toEqual([other]);
      await ctx.prisma.promoCode.delete({ where: { id: promo.id } });
    });

    it('ends as failed, with nothing changed, when the ordinary service refuses it at approval', async () => {
      // Two people's agents each drafted a refund of the whole payment.
      const whole = refundDraft({ amountMinor: paid.amountMinor });
      const first = await drafted(ops, 'finance.draft_refund_request', whole);
      const second = await drafted(help, 'finance.draft_refund_request', whole);
      await decide(fin, first, 'approve').expect(200);
      // The first is now an open refund request for all of it: the second cannot be made.
      const failed = (await decide(fin, second, 'approve').expect(200)).body as Approval;
      expect(failed).toMatchObject({ status: 'failed', reason: 'refused', result: null });
      expect(await ctx.prisma.refund.count({ where: { bookingId } })).toBe(1);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'agent.approval_approved', targetId: second },
      });
      expect(audit.metadata).toMatchObject({ carriedOut: false, reason: 'refused' });
    });

    it('lets a proposal nobody decided lapse', async () => {
      const id = await drafted(ops, 'marketing.draft_promo', promoDraft('STALE10'));
      await ctx.prisma.agentApproval.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const late = await decide(root, id, 'approve');
      expect([late.status, (late.body as { type: string }).type]).toEqual([
        409,
        expect.stringContaining('approval-decided'),
      ]);
      expect((await queue(root)).approvals).toEqual([]);
      expect((await queue(root, 'expired')).approvals.map((row) => row.id)).toEqual([id]);
      expect(await ctx.prisma.promoCode.count({ where: { code: 'STALE10' } })).toBe(0);
      // The same draft can be prepared again once the old one is gone.
      const again = await drafted(ops, 'marketing.draft_promo', promoDraft('STALE10'));
      expect(again).not.toBe(id);
      expect(await ctx.app.get(AgentApprovalsService).expireDue()).toBe(0);
    });

    it('carries a draft from a console chat to the queue, under the person who asked', async () => {
      const conversationId = await converse(ops);
      let answer: Answer<Proposal> | null = null;
      mock.use(async (request, emit) => {
        const response = await ctx
          .http()
          .post('/v1/internal/agent-tools/finance.draft_refund_request')
          .set('authorization', `Bearer ${TOOLS_TOKEN}`)
          // Whoever the model says it works for, the grant decides: these are not arguments.
          .send({
            grant: request.grant,
            agent: 'finance_prep',
            arguments: { ...refundDraft(), requestedBy: root.userId, userId: fin.userId },
          });
        answer = response.body as Answer<Proposal>;
        await emit(said('finance_prep', 'I prepared it. Someone else decides it.'));
      });
      const sent = await ask(ops, conversationId, 'Prepare a goodwill refund.').expect(202);
      await ctx.background.drain();
      expect(answer).toMatchObject({ status: 'ok', result: { waitsForApproval: true } });

      const row = await ctx.prisma.agentApproval.findFirstOrThrow();
      expect(row).toMatchObject({
        requestedBy: ops.userId,
        conversationId,
        runId: (sent.body as { runId: string }).runId,
        agent: 'finance_prep',
        status: 'pending',
      });
      // The call is on the run's record with the names of its arguments, never their values.
      const calls = await ctx.prisma.agentToolCall.findMany({ where: { runId: row.runId } });
      expect(calls.map((entry) => [entry.tool, entry.tier, entry.status])).toEqual([
        ['finance.draft_refund_request', 'propose', 'ok'],
      ]);
      expect(JSON.stringify(calls)).not.toContain(paymentId);

      // Asking is not deciding: the asker's own approval is refused, another person's works.
      await decide(ops, row.id, 'approve').expect(403);
      await decide(fin, row.id, 'approve').expect(200);
      expect(
        await ctx.prisma.refund.count({ where: { bookingId, requestedByUserId: fin.userId } }),
      ).toBe(1);
    });
  });
});
