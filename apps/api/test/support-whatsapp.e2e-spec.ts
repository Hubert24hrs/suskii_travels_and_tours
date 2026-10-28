import { createHmac } from 'node:crypto';

import { MockWhatsAppChannel } from '../src/support/whatsapp/whatsapp-channel';

import { staffSession } from './helpers/admin';
import { bearer, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * WhatsApp as a support channel (ADR-084): signed deliveries land in the support inbox, repeats
 * change nothing, staff replies go as text inside the 24-hour window and as the template notice
 * outside it (the text follows when the traveller writes back), statuses only move forward, and
 * nothing unsigned gets in.
 */

const APP_SECRET = 'e2e-whatsapp-app-secret-0123456789';
const VERIFY_TOKEN = 'e2e-whatsapp-verify-token-0123';
const PHONE_NUMBER_ID = '106540352242922';
const PHONE = '2348012345678';
let sequence = 0;
const wamid = (): string => `wamid.e2e-${Date.now()}-${(sequence += 1)}`;
const seconds = (date: Date): string => String(Math.floor(date.getTime() / 1000));

interface AdminConversation {
  id: string;
  reference: string;
  status: string;
  channel: string;
  customer: { label: string };
  whatsapp: { windowClosesAt: string | null; optedOut: boolean; reachable: boolean } | null;
  messages: {
    id: string;
    author: string;
    kind: string;
    text: string;
    delivery: { status: string; error: string | null; noticeSentAt: string | null } | null;
  }[];
}

describe('whatsapp support (e2e)', () => {
  let ctx: TestContext;
  let agent: TokenSession;
  let channel: MockWhatsAppChannel;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      WHATSAPP_SUPPORT_PROVIDER: 'mock',
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    });
    channel = ctx.app.get(MockWhatsAppChannel);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    channel.outbox.splice(0);
    channel.failWith = null;
    agent = await staffSession(ctx, 'agent@suskii.test', ['support']);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const deliver = (value: Record<string, unknown>, secret = APP_SECRET) => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value }] }],
    });
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    return ctx
      .http()
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(body);
  };
  const text = (body: string, options: { id?: string; at?: Date; from?: string } = {}) => ({
    metadata: { phone_number_id: PHONE_NUMBER_ID },
    contacts: [{ wa_id: options.from ?? PHONE, profile: { name: 'Ada' } }],
    messages: [
      {
        from: options.from ?? PHONE,
        id: options.id ?? wamid(),
        timestamp: seconds(options.at ?? new Date()),
        type: 'text',
        text: { body },
      },
    ],
  });
  const conversation = async (id: string) =>
    (
      await ctx
        .http()
        .get(`/v1/admin/support/conversations/${id}`)
        .set(bearer(agent.accessToken))
        .expect(200)
    ).body as AdminConversation;
  const onlyConversation = async () => {
    const rows = await ctx.prisma.supportConversation.findMany({ select: { id: true } });
    expect(rows).toHaveLength(1);
    return conversation(rows[0]!.id);
  };
  const reply = (id: string, message: string) =>
    ctx
      .http()
      .post(`/v1/admin/support/conversations/${id}/messages`)
      .set(bearer(agent.accessToken))
      .send({ message, internal: false })
      .expect(201);

  it('answers the handshake only with the verify token', async () => {
    const ok = await ctx
      .http()
      .get('/v1/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      })
      .expect(200);
    expect(ok.text).toBe('1158201444');
    expect(ok.headers['content-type']).toMatch(/^text\/plain/);
    await ctx
      .http()
      .get('/v1/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token-000000',
        'hub.challenge': '1',
      })
      .expect(403);
  });

  it('refuses unsigned or wrongly signed deliveries and stores nothing', async () => {
    await deliver(text('Hello'), 'not-the-app-secret-000000').expect(401);
    await ctx
      .http()
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(text('Hello')))
      .expect(401);
    expect(await ctx.prisma.whatsAppContact.count()).toBe(0);
    expect(await ctx.prisma.supportConversation.count()).toBe(0);
  });

  it('opens a conversation in the inbox, keeps the number sealed and ignores a repeated delivery', async () => {
    const id = wamid();
    await deliver(text('Can I change my flight to Friday?', { id })).expect(200);
    await deliver(text('Can I change my flight to Friday?', { id })).expect(200);

    const found = await onlyConversation();
    expect(found).toMatchObject({
      channel: 'whatsapp',
      status: 'open',
      customer: { label: 'WhatsApp •••• 5678' },
      whatsapp: { optedOut: false, reachable: true },
    });
    expect(found.whatsapp?.windowClosesAt).not.toBeNull();
    expect(found.messages).toEqual([
      expect.objectContaining({
        author: 'customer',
        kind: 'text',
        text: 'Can I change my flight to Friday?',
      }),
    ]);
    const contact = await ctx.prisma.whatsAppContact.findFirstOrThrow();
    expect(contact.phoneEncrypted).not.toContain(PHONE);
    expect(contact.phoneHash).not.toContain(PHONE);

    // Another message joins the same conversation; a photo is recorded by type only.
    await deliver({
      contacts: [{ wa_id: PHONE }],
      messages: [
        {
          from: PHONE,
          id: wamid(),
          timestamp: seconds(new Date()),
          type: 'image',
          image: { id: 'media-1' },
        },
      ],
    }).expect(200);
    const after = await conversation(found.id);
    expect(after.messages.map((message) => [message.kind, message.text])).toEqual([
      ['text', 'Can I change my flight to Friday?'],
      ['unsupported', 'image'],
    ]);
  });

  it('sends a reply inside the window as text and moves its status forward only', async () => {
    await deliver(text('Is my hotel paid?')).expect(200);
    const { id } = await onlyConversation();

    await reply(id, 'Yes, it is paid in full.');
    expect(channel.outbox).toEqual([
      expect.objectContaining({ kind: 'text', to: PHONE, body: 'Yes, it is paid in full.' }),
    ]);
    const sent = (await conversation(id)).messages.at(-1);
    expect(sent?.delivery).toEqual({ status: 'sent', error: null, noticeSentAt: null });

    const outId = channel.outbox[0]!.messageId;
    const statuses = (status: string) => ({
      statuses: [{ id: outId, status, timestamp: seconds(new Date()), recipient_id: PHONE }],
    });
    await deliver(statuses('read')).expect(200);
    await deliver(statuses('delivered')).expect(200);
    expect((await conversation(id)).messages.at(-1)?.delivery?.status).toBe('read');
    expect((await conversation(id)).status).toBe('waiting');
  });

  it('outside the window sends the template notice, then the reply once the traveller writes back', async () => {
    const yesterday = new Date(Date.now() - 25 * 3_600_000);
    await deliver(text('Do you sell travel insurance?', { at: yesterday })).expect(200);
    const found = await onlyConversation();
    expect(found.whatsapp?.windowClosesAt).toBeNull();

    await reply(found.id, 'We do: it is an add-on at checkout.');
    expect(channel.outbox).toEqual([
      expect.objectContaining({
        kind: 'template',
        to: PHONE,
        template: { name: 'support_reply_waiting', language: 'en', parameters: [found.reference] },
      }),
    ]);
    const waiting = (await conversation(found.id)).messages.at(-1)?.delivery;
    expect(waiting?.status).toBe('pending');
    expect(waiting?.noticeSentAt).not.toBeNull();

    await deliver(text('Thanks, what does it cover?')).expect(200);
    expect(channel.outbox.at(-1)).toMatchObject({
      kind: 'text',
      body: 'We do: it is an add-on at checkout.',
    });
    const forwarded = (await conversation(found.id)).messages.find(
      (message) => message.text === 'We do: it is an add-on at checkout.',
    );
    expect(forwarded?.delivery?.status).toBe('sent');
  });

  it('after STOP sends no template, records why, and owes nobody a reply', async () => {
    const yesterday = new Date(Date.now() - 25 * 3_600_000);
    await deliver(text('Where is my e-ticket?', { at: yesterday })).expect(200);
    const found = await onlyConversation();
    await deliver(text('STOP', { at: yesterday })).expect(200);
    const stopped = await conversation(found.id);
    expect(stopped.whatsapp?.optedOut).toBe(true);

    await reply(found.id, 'It is attached to your booking email.');
    expect(channel.outbox).toEqual([]);
    expect((await conversation(found.id)).messages.at(-1)?.delivery).toMatchObject({
      status: 'failed',
      error: 'opted-out',
    });
  });

  it('keeps internal notes off WhatsApp and records a refused send', async () => {
    await deliver(text('Please call me')).expect(200);
    const { id } = await onlyConversation();
    await ctx
      .http()
      .post(`/v1/admin/support/conversations/${id}/messages`)
      .set(bearer(agent.accessToken))
      .send({ message: 'Asked for a call; no phone support yet.', internal: true })
      .expect(201);
    expect(channel.outbox).toEqual([]);

    channel.failWith = 'meta-131026';
    await reply(id, 'We answer here, by chat.');
    expect((await conversation(id)).messages.at(-1)?.delivery).toMatchObject({
      status: 'failed',
      error: 'meta-131026',
    });
  });

  it('records a username user by business-scoped id, and says why a reply cannot go yet', async () => {
    await deliver({
      contacts: [{ user_id: 'NG.e2e-bsuid.1' }],
      messages: [
        {
          from_user_id: 'NG.e2e-bsuid.1',
          id: wamid(),
          timestamp: seconds(new Date()),
          type: 'text',
          text: { body: 'hello' },
        },
      ],
    }).expect(200);
    const found = await onlyConversation();
    expect(found.customer.label).toBe('WhatsApp user');
    expect(found.whatsapp?.reachable).toBe(false);
    await reply(found.id, 'Hello, how can we help?');
    expect(channel.outbox).toEqual([]);
    expect((await conversation(found.id)).messages.at(-1)?.delivery?.error).toBe('no-phone');
  });

  it('ignores messages for another business number', async () => {
    await deliver({ ...text('Hi'), metadata: { phone_number_id: '999999999999' } }).expect(200);
    expect(await ctx.prisma.supportConversation.count()).toBe(0);
  });
});
