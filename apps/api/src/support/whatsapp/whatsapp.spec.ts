import { createHmac } from 'node:crypto';

import { CloudWhatsAppChannel, WhatsAppSendError } from './whatsapp-channel';
import { parseWhatsAppDelivery, whatsappSignatureValid } from './whatsapp-webhook';

const SECRET = 'app-secret-0123456789';
const sign = (body: Buffer): string =>
  `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;

const delivery = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value }] }],
});

describe('whatsapp webhook (ADR-084)', () => {
  it('accepts only an HMAC-SHA256 of the exact bytes under the app secret', () => {
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    expect(whatsappSignatureValid(body, sign(body), SECRET)).toBe(true);
    expect(
      whatsappSignatureValid(body, sign(body).toUpperCase().replace('SHA256=', 'sha256='), SECRET),
    ).toBe(true);
    expect(whatsappSignatureValid(Buffer.from(`${body.toString()} `), sign(body), SECRET)).toBe(
      false,
    );
    expect(whatsappSignatureValid(body, sign(body).replace('sha256=', 'sha1='), SECRET)).toBe(
      false,
    );
    expect(whatsappSignatureValid(body, undefined, SECRET)).toBe(false);
    expect(whatsappSignatureValid(undefined, sign(body), SECRET)).toBe(false);
  });

  it('reads texts, attachments, business-scoped ids and statuses, and skips what it cannot use', () => {
    const [parsed] = parseWhatsAppDelivery(
      delivery({
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15550001111', phone_number_id: '106540352242922' },
        contacts: [{ profile: { name: 'Ada' }, wa_id: '2348012345678', user_id: 'NG.bsuid.1' }],
        messages: [
          {
            from: '2348012345678',
            id: 'wamid.A',
            timestamp: '1761645600',
            type: 'text',
            text: { body: '  Is my flight on time?  ' },
          },
          {
            from: '2348012345678',
            id: 'wamid.B',
            timestamp: '1761645601',
            type: 'image',
            image: { id: 'm1' },
          },
          {
            from: '2348012345678',
            id: 'wamid.C',
            timestamp: '1761645602',
            type: 'text',
            text: { body: '   ' },
          },
          { id: 'wamid.D', timestamp: 'yesterday', type: 'text', text: { body: 'bad time' } },
        ],
        statuses: [
          {
            id: 'wamid.S1',
            status: 'read',
            timestamp: '1761645700',
            recipient_id: '2348012345678',
          },
          {
            id: 'wamid.S2',
            status: 'failed',
            timestamp: '1761645701',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'wamid.S3', status: 'deleted', timestamp: '1761645702' },
        ],
      }),
    );
    expect(parsed?.phoneNumberId).toBe('106540352242922');
    expect(parsed?.messages).toEqual([
      {
        messageId: 'wamid.A',
        phone: '2348012345678',
        bsuid: 'NG.bsuid.1',
        sentAt: new Date(1761645600_000),
        kind: 'text',
        body: 'Is my flight on time?',
      },
      {
        messageId: 'wamid.B',
        phone: '2348012345678',
        bsuid: 'NG.bsuid.1',
        sentAt: new Date(1761645601_000),
        kind: 'unsupported',
        body: 'image',
      },
    ]);
    expect(parsed?.statuses).toEqual([
      { messageId: 'wamid.S1', status: 'read', error: null },
      { messageId: 'wamid.S2', status: 'failed', error: 'meta-131047' },
    ]);
  });

  it('takes a username user by business-scoped id when no number is sent', () => {
    const [parsed] = parseWhatsAppDelivery(
      delivery({
        contacts: [{ user_id: 'NG.bsuid.2' }],
        messages: [
          {
            from_user_id: 'NG.bsuid.2',
            id: 'wamid.E',
            timestamp: '1761645600',
            type: 'text',
            text: { body: 'hello' },
          },
        ],
      }),
    );
    expect(parsed?.messages[0]).toMatchObject({ phone: null, bsuid: 'NG.bsuid.2', body: 'hello' });
  });

  it('ignores other objects and other fields', () => {
    expect(parseWhatsAppDelivery({ object: 'page', entry: [] })).toEqual([]);
    expect(
      parseWhatsAppDelivery({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'message_template_status_update', value: {} }] }],
      }),
    ).toEqual([]);
    expect(parseWhatsAppDelivery('not json')).toEqual([]);
  });
});

describe('CloudWhatsAppChannel', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const respond = (status: number, body: unknown): typeof fetch =>
    ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }) as typeof fetch;
  const channel = (fetchImpl: typeof fetch) =>
    new CloudWhatsAppChannel({
      baseUrl: 'https://graph.facebook.com/v26.0',
      phoneNumberId: '106540352242922',
      accessToken: 'EAAG-test-token-0123456789',
      fetch: fetchImpl,
    });

  beforeEach(() => calls.splice(0));

  it('sends text with the token in the header and returns the message id', async () => {
    const sent = await channel(respond(200, { messages: [{ id: 'wamid.OUT' }] })).sendText(
      '2348012345678',
      'Your flight is on time.',
      AbortSignal.timeout(1000),
    );
    expect(sent).toEqual({ messageId: 'wamid.OUT' });
    const [call] = calls;
    expect(call?.url).toBe('https://graph.facebook.com/v26.0/106540352242922/messages');
    expect(call?.init.redirect).toBe('error');
    expect((call?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer EAAG-test-token-0123456789',
    );
    expect(call?.url).not.toContain('EAAG');
    expect(JSON.parse(call?.init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '2348012345678',
      type: 'text',
      text: { body: 'Your flight is on time.', preview_url: false },
    });
  });

  it('sends the template with its body parameter', async () => {
    await channel(respond(200, { messages: [{ id: 'wamid.T' }] })).sendTemplate(
      '2348012345678',
      { name: 'support_reply_waiting', language: 'en', parameters: ['S-7KX2Q9'] },
      AbortSignal.timeout(1000),
    );
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      type: 'template',
      template: {
        name: 'support_reply_waiting',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'S-7KX2Q9' }] }],
      },
    });
  });

  it("keeps only Meta's error code, never the message", async () => {
    const failing = channel(
      respond(400, { error: { message: 'Message failed: Your flight is on time.', code: 131047 } }),
    );
    const error = await failing
      .sendText('2348012345678', 'Your flight is on time.', AbortSignal.timeout(1000))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect((error as WhatsAppSendError).code).toBe('meta-131047');
    expect((error as Error).message).not.toContain('flight');
  });

  it('reports a timeout as such', async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const error = await channel(hanging)
      .sendText('2348012345678', 'hi', AbortSignal.timeout(10))
      .catch((caught: unknown) => caught);
    expect((error as WhatsAppSendError).code).toBe('timeout');
  });
});
