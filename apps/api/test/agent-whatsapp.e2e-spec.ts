import { createHmac } from 'node:crypto';

import type { AgentRunEvent, AgentRunRequest } from '@suskii/shared';

import { AgentGrants } from '../src/agent/agent-grants';
import { AgentPause } from '../src/agent/agent-pause';
import { MockAgentClient } from '../src/agent/chat/agent-client';
import {
  AGENT_WHATSAPP_DISCLOSURE,
  AGENT_WHATSAPP_HANDOVER,
} from '../src/agent/whatsapp/agent-whatsapp.service';
import { MockWhatsAppChannel } from '../src/support/whatsapp/whatsapp-channel';

import { staffSession } from './helpers/admin';
import { bearer, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The assistant on WhatsApp (ADR-084, ADR-101): a traveller's message is answered inside the
 * support conversation it opens, as a guest's run, until a person replies, the assistant hands
 * over or it has answered enough. Whatever goes wrong ends in the handover to people. With the
 * switch off the channel is exactly the support channel it was. The agent service is played
 * by a mock the tests script; Meta by the mock channel.
 */

const APP_SECRET = 'e2e-whatsapp-app-secret-0123456789';
const VERIFY_TOKEN = 'e2e-whatsapp-verify-token-0123';
const PHONE_NUMBER_ID = '106540352242922';
const PHONE = '2348012345678';
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefgh';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghij';

let sequence = 0;
const wamid = (): string => `wamid.agent-${Date.now()}-${(sequence += 1)}`;
const seconds = (date: Date): string => String(Math.floor(date.getTime() / 1000));

interface AdminConversation {
  id: string;
  status: string;
  channel: string;
  messages: {
    author: string;
    kind: string;
    internal: boolean;
    text: string;
    delivery: { status: string; error: string | null } | null;
  }[];
}

type End = Extract<AgentRunEvent, { type: 'end' }>;

/** One model call's usage: 4000 micro-dollars at the prices below, or nothing. */
const usage = (priced: boolean): End['usage'] => [
  {
    role: 'specialist',
    provider: 'mock',
    model: 'mock-specialist',
    calls: 1,
    inputTokens: priced ? 1000 : 0,
    outputTokens: priced ? 200 : 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
];
const answered = (text: string, over: Partial<End> = {}): End => ({
  type: 'end',
  outcome: 'answered',
  agent: 'flights',
  agents: ['flights'],
  answer: { kind: 'text', text, cards: [], sources: ['flights.search#1'] },
  notice: null,
  confirmationId: null,
  prompts: ['router@1', 'flights@1'],
  steps: 2,
  usage: usage(false),
  ...over,
});

const SETTINGS = {
  RATE_LIMIT_ENABLED: false,
  WHATSAPP_SUPPORT_PROVIDER: 'mock',
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
  AGENT_ENABLED: true,
  AGENT_SERVICE: 'mock',
  AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
  AGENT_RUN_TOKEN: RUN_TOKEN,
  AGENT_MODEL_PRICES: {
    'mock-specialist': { input: 2_000_000, output: 10_000_000, cacheRead: 0, cacheWrite: 0 },
  },
  AGENT_RUN_RESERVE_MICROUSD: 5000,
  // Two priced answers (8000) fit; the third run's reservation does not.
  AGENT_GUEST_DAILY_MICROUSD: 9000,
} as const;

function harness(getContext: () => TestContext) {
  const deliver = (value: Record<string, unknown>) => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value }] }],
    });
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
    return getContext()
      .http()
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(body);
  };
  /** A traveller's text, delivered and fully processed (the answer included). */
  const writes = async (body: string, from = PHONE): Promise<void> => {
    await deliver({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      contacts: [{ wa_id: from, profile: { name: 'Ada' } }],
      messages: [
        { from, id: wamid(), timestamp: seconds(new Date()), type: 'text', text: { body } },
      ],
    }).expect(200);
    await getContext().background.drain();
  };
  return { writes };
}

describe('the assistant on whatsapp (e2e)', () => {
  let ctx: TestContext;
  let staff: TokenSession;
  let channel: MockWhatsAppChannel;
  let mock: MockAgentClient;
  const { writes } = harness(() => ctx);

  beforeAll(async () => {
    ctx = await createTestApp({
      ...SETTINGS,
      AGENT_WHATSAPP_ENABLED: true,
      AGENT_WHATSAPP_MAX_REPLIES: 3,
    });
    channel = ctx.app.get(MockWhatsAppChannel);
    mock = ctx.app.get(MockAgentClient);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    channel.outbox.splice(0);
    channel.failWith = null;
    mock.use(null);
    staff = await staffSession(ctx, 'wa-agent@suskii.test', ['support']);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  const thread = async (): Promise<AdminConversation> => {
    const rows = await ctx.prisma.supportConversation.findMany({ select: { id: true } });
    expect(rows).toHaveLength(1);
    return (
      await ctx
        .http()
        .get(`/v1/admin/support/conversations/${rows[0]!.id}`)
        .set(bearer(staff.accessToken))
        .expect(200)
    ).body as AdminConversation;
  };
  /** What was said in the thread: every message but the internal notes for staff. */
  const said = async (): Promise<[string, string, string][]> =>
    (await thread()).messages
      .filter((message) => !message.internal)
      .map((message) => [message.author, message.kind, message.text]);

  it('answers in the thread as a guest, with the disclosure first and cards as plain lines', async () => {
    let sent: AgentRunRequest | null = null;
    mock.use(async (request, emit) => {
      sent = request;
      await emit(
        answered('The first flight leaves at 06:45.', {
          answer: {
            kind: 'text',
            text: 'The first flight leaves at 06:45.',
            cards: [
              {
                kind: 'flight',
                title: 'Lagos to Abuja',
                lines: ['XY 101, 06:45 to 08:00'],
                price: { amountMinor: 8_550_000, currency: 'NGN' },
                href: '/flights',
              },
              {
                kind: 'price',
                title: 'Seen on another site',
                lines: ['2026-11-10 08:00 UTC'],
                price: { amountMinor: 8_000_000, currency: 'NGN' },
                indicative: true,
              },
            ],
            sources: ['flights.search#1'],
          },
        }),
      );
    });

    await writes('Flights from Lagos to Abuja on Friday? Call me on +234 801 234 5678.');

    const messages = (await thread()).messages;
    expect(messages.map((message) => [message.author, message.kind])).toEqual([
      ['customer', 'text'],
      ['assistant', 'text'],
    ]);
    const answer = messages[1]!;
    expect(answer.text.startsWith(AGENT_WHATSAPP_DISCLOSURE)).toBe(true);
    expect(answer.text).toContain('The first flight leaves at 06:45.');
    expect(answer.text).toContain('Lagos to Abuja\nXY 101, 06:45 to 08:00\n');
    expect(answer.text).toContain('85,500');
    expect(answer.text).toContain('https://web.suskii.test/flights');
    // A price read elsewhere says so on WhatsApp too (ADR-104).
    expect(answer.text).toMatch(/80,000[^\n]* \(indicative: seen elsewhere/);
    expect(answer.delivery).toMatchObject({ status: 'sent', error: null });
    expect(channel.outbox).toEqual([
      expect.objectContaining({ kind: 'text', to: PHONE, body: answer.text }),
    ]);

    // The model was asked as a guest on WhatsApp, and never saw the number.
    const request = sent as AgentRunRequest | null;
    expect(request?.context).toMatchObject({ channel: 'whatsapp', signedIn: false });
    expect(request?.input).toMatchObject({ kind: 'message' });
    expect(JSON.stringify(request?.input)).not.toMatch(/801|234 5678/);
    const grant = ctx.app.get(AgentGrants).open(request?.grant ?? '');
    expect(grant).toMatchObject({ userId: null, roles: [], channel: 'whatsapp' });
    expect(grant?.scopes).not.toContain('account');

    // One conversation of the assistant per thread, which no traveller route opens.
    const found = await thread();
    const linked = await ctx.prisma.agentConversation.findMany();
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      channel: 'whatsapp',
      audience: 'customer',
      userId: null,
      accessTokenHash: null,
      supportConversationId: found.id,
      messageCount: 2,
    });
    await ctx.http().get(`/v1/agent/conversations/${linked[0]!.id}`).expect(404);
    await ctx
      .http()
      .get(`/v1/agent/conversations/${linked[0]!.id}`)
      .set('X-Agent-Token', 'guess-0123456789-abcdefghijklmnopqrstuvwxyz')
      .expect(404);

    // The next answer joins the same conversation and repeats no disclosure.
    mock.use(async (_request, emit) => emit(answered('It lands at 08:00.')));
    await writes('And when does it land?');
    expect((await said()).at(-1)).toEqual(['assistant', 'text', 'It lands at 08:00.']);
    expect(await ctx.prisma.agentConversation.count()).toBe(1);
    expect(channel.outbox).toHaveLength(2);
  });

  it('reaches nothing of an account, and a handover stays in the same chat', async () => {
    let handover: unknown = null;
    let bookings: unknown = null;
    mock.use(async (request, emit) => {
      const call = async (tool: string, agent: string) =>
        (
          await ctx
            .http()
            .post(`/v1/internal/agent-tools/${tool}`)
            .set('Authorization', `Bearer ${TOOLS_TOKEN}`)
            .send({ grant: request.grant, agent, arguments: {} })
        ).body as unknown;
      bookings = await call('bookings.list', 'bookings');
      handover = await call('support.handover', 'support');
      await emit(
        answered('I have asked our team to take over here.', {
          outcome: 'handover',
          agent: 'support',
          agents: ['support'],
          answer: {
            kind: 'handover',
            text: 'I have asked our team to take over here.',
            cards: [],
            sources: ['support.handover#1'],
          },
        }),
      );
    });

    await writes('I want to talk to a person about my booking.');

    expect(bookings).toMatchObject({ status: 'denied', result: null });
    // Nothing new is opened: the chat is the support conversation already.
    expect(handover).toMatchObject({
      status: 'ok',
      result: { handedOver: true, alreadyOpen: true, needsTheSupportPage: false, cards: [] },
    });
    expect(await ctx.prisma.supportConversation.count()).toBe(1);
    expect(await said()).toEqual([
      ['customer', 'text', 'I want to talk to a person about my booking.'],
      ['assistant', 'handover', 'I have asked our team to take over here.'],
    ]);
    expect(channel.outbox).toEqual([
      expect.objectContaining({ kind: 'text', body: 'I have asked our team to take over here.' }),
    ]);
    // The thread is still open and owed a reply: nothing of its status or times was touched.
    expect((await thread()).status).toBe('open');
    // Staff find a note of what was tried: names and outcomes, never anyone's words.
    const note = await ctx.prisma.supportMessage.findFirstOrThrow({ where: { internal: true } });
    expect(note.author).toBe('system');
    const told = (await thread()).messages.find((message) => message.internal)?.text ?? '';
    expect(told).toContain('Why: handover.');
    expect(told).toContain('bookings.list denied (scope)');
    expect(told).toContain('support.handover ok');
    expect(told).not.toContain('talk to a person');
    // A note is not a message to the traveller: nothing more went out on WhatsApp.
    expect(channel.outbox).toHaveLength(1);

    // After a handover the thread is for people.
    mock.use(null);
    await writes('Hello?');
    expect(mock.requests).toHaveLength(0);
    expect((await said()).at(-1)).toEqual(['customer', 'text', 'Hello?']);
  });

  it('stops for good once a person has replied', async () => {
    await writes('Is my hotel paid?');
    expect((await said()).map(([author]) => author)).toEqual(['customer', 'assistant']);
    const { id } = await thread();
    await ctx
      .http()
      .post(`/v1/admin/support/conversations/${id}/messages`)
      .set(bearer(staff.accessToken))
      .send({ message: 'Yes, it is paid in full.', internal: false })
      .expect(201);

    mock.use(null);
    await writes('Thank you. Can I add breakfast?');
    expect(mock.requests).toHaveLength(0);
    expect((await said()).map(([author]) => author)).toEqual([
      'customer',
      'assistant',
      'staff',
      'customer',
    ]);
  });

  it('hands over, in its own words, when the run fails or leaves nothing to read', async () => {
    mock.use(() => {
      throw new Error('the agent service is down');
    });
    await writes('Do I need a visa for Ghana?');
    expect(await said()).toEqual([
      ['customer', 'text', 'Do I need a visa for Ghana?'],
      ['assistant', 'handover', AGENT_WHATSAPP_HANDOVER],
    ]);
    expect(channel.outbox).toEqual([
      expect.objectContaining({ kind: 'text', to: PHONE, body: AGENT_WHATSAPP_HANDOVER }),
    ]);

    // An answer the guard blocked is a notice the chat cannot show: people take it.
    const other = '2348098765432';
    mock.use(async (_request, emit) =>
      emit(
        answered('', {
          outcome: 'guard_blocked',
          answer: null,
          notice: 'cannot_answer',
        }),
      ),
    );
    await writes('What is the cheapest flight to Accra?', other);
    const rows = await ctx.prisma.supportMessage.findMany({
      where: { author: 'assistant' },
      select: { kind: true },
    });
    expect(rows.map((row) => row.kind)).toEqual(['handover', 'handover']);
    expect(channel.outbox.at(-1)).toMatchObject({ to: other, body: AGENT_WHATSAPP_HANDOVER });
  });

  it('greets by rule, and leaves STOP alone', async () => {
    mock.use(async (_request, emit) =>
      emit(
        answered('', {
          agent: 'concierge',
          agents: ['concierge'],
          answer: null,
          notice: 'greeting',
          usage: [],
        }),
      ),
    );
    await writes('Hello');
    const greeting = (await said()).at(-1);
    expect(greeting?.slice(0, 2)).toEqual(['assistant', 'text']);
    expect(greeting?.[2]).toContain('Ask me about flights');

    mock.use(null);
    await writes('STOP');
    expect(mock.requests).toHaveLength(0);
    expect((await said()).filter(([author]) => author === 'assistant')).toHaveLength(1);
    expect(channel.outbox).toHaveLength(1);
  });

  it('hands over after its reply limit, and when the day’s spend for the contact is used', async () => {
    mock.use(async (_request, emit) => emit(answered('Here is what I found.')));
    for (const question of ['One?', 'Two?', 'Three?']) await writes(question);
    expect(mock.requests).toHaveLength(3);
    await writes('Four?');
    // The fourth is not sent to a model at all.
    expect(mock.requests).toHaveLength(3);
    expect((await said()).at(-1)).toEqual(['assistant', 'handover', AGENT_WHATSAPP_HANDOVER]);

    // Another contact, with answers that cost: two fit under the guest cap, the third does not.
    const other = '2348055555555';
    mock.use(async (_request, emit) => emit(answered('Priced answer.', { usage: usage(true) })));
    for (const question of ['A?', 'B?', 'C?']) await writes(question, other);
    expect(mock.requests).toHaveLength(2);
    const rows = await ctx.prisma.supportMessage.findMany({
      where: { author: 'assistant', conversation: { whatsappContact: { isNot: null } } },
      orderBy: { id: 'asc' },
      select: { kind: true },
    });
    expect(rows.map((row) => row.kind).slice(-3)).toEqual(['text', 'text', 'handover']);
  });

  it('answers nothing while paused, and leaves the message in the inbox', async () => {
    await ctx.app.get(AgentPause).pause('maintenance');
    await writes('Are there flights to Kano tomorrow?');
    expect(mock.requests).toHaveLength(0);
    expect(await said()).toEqual([['customer', 'text', 'Are there flights to Kano tomorrow?']]);
    expect(channel.outbox).toHaveLength(0);
    expect(await ctx.prisma.agentConversation.count()).toBe(0);
  });
});

describe('whatsapp with the assistant switched off for it (e2e)', () => {
  let ctx: TestContext;
  const { writes } = harness(() => ctx);

  beforeAll(async () => {
    // The assistant is on for the website and the app; WhatsApp needs its own switch.
    ctx = await createTestApp({ ...SETTINGS });
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  it('stores the message for people and asks no model', async () => {
    await resetState(ctx);
    const mock = ctx.app.get(MockAgentClient);
    mock.use(null);
    await writes('Can I change my flight to Friday?');

    expect(mock.requests).toHaveLength(0);
    const messages = await ctx.prisma.supportMessage.findMany({ select: { author: true } });
    expect(messages).toEqual([{ author: 'customer' }]);
    expect(ctx.app.get(MockWhatsAppChannel).outbox).toHaveLength(0);
    expect(await ctx.prisma.agentConversation.count()).toBe(0);
  });
});
