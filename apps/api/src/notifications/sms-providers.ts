import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { SmsProvider, SmsSendError, type SmsMessage } from './sms';

/** Options shared by the HTTP adapters; `fetch` is replaced in tests (no test calls a provider). */
interface HttpOptions {
  timeoutMs: number;
  fetch?: typeof fetch;
}

/**
 * One POST to a provider: TLS hosts only (checked at boot), no redirects, a timeout, and failures
 * reduced to a code. Neither the number nor the message ever reaches a log or an error.
 */
async function post(
  provider: string,
  fetchImpl: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: string },
  timeoutMs: number,
): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', ...init.headers },
      body: init.body,
    });
  } catch (error) {
    const name = (error as Error).name;
    throw new SmsSendError(provider, name === 'TimeoutError' ? 'timeout' : 'network');
  }
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

/** International digits without the plus, the form both providers' examples use for Nigeria. */
const digitsOnly = (e164: string): string => e164.replace(/^\+/, '');

// ---------------------------------------------------------------------------
// Termii (Nigeria)
// ---------------------------------------------------------------------------

export interface TermiiOptions extends HttpOptions {
  /** Account base URL, e.g. https://api.ng.termii.com (newer accounts get their own host). */
  baseUrl: string;
  apiKey: string;
  /** Approved sender ID (up to 11 characters). */
  senderId: string;
  /** `dnd` reaches numbers on Nigeria's Do-Not-Disturb list (transactional route); `generic` does not. */
  channel: 'dnd' | 'generic';
}

const termiiSent = z.looseObject({ message_id: z.union([z.string(), z.number()]) });

/**
 * Termii's messaging API: `POST /api/sms/send` with JSON `to`, `from`, `sms`, `type: plain`,
 * `channel` and the `api_key` in the body (never the URL). A message id means accepted.
 */
export class TermiiSmsProvider extends SmsProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TermiiOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async send(message: SmsMessage): Promise<void> {
    const { status, json } = await post(
      'termii',
      this.fetchImpl,
      `${this.options.baseUrl.replace(/\/$/, '')}/api/sms/send`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: digitsOnly(message.to),
          from: this.options.senderId,
          sms: message.body,
          type: 'plain',
          channel: this.options.channel,
          api_key: this.options.apiKey,
        }),
      },
      this.options.timeoutMs,
    );
    if (status < 200 || status >= 300) throw new SmsSendError('termii', `http-${status}`);
    if (!termiiSent.safeParse(json).success) throw new SmsSendError('termii', 'unexpected-answer');
  }
}

// ---------------------------------------------------------------------------
// Africa's Talking (Kenya, Uganda, Tanzania, Rwanda, Malawi, Nigeria, ...)
// ---------------------------------------------------------------------------

export interface AfricasTalkingOptions extends HttpOptions {
  username: string;
  apiKey: string;
  /** Registered sender ID or short code; the account default when null. */
  senderId: string | null;
  /** https://api.africastalking.com, or https://api.sandbox.africastalking.com with username `sandbox`. */
  baseUrl: string;
}

const atAnswer = z.looseObject({
  SMSMessageData: z.looseObject({
    Recipients: z.array(
      z.looseObject({ statusCode: z.coerce.number().int(), status: z.string().optional() }),
    ),
  }),
});

/** Per-recipient codes Africa's Talking documents as accepted: processed, sent, queued. */
const AT_ACCEPTED = new Set([100, 101, 102]);

/**
 * Africa's Talking: `POST /version1/messaging` as a form with `username`, `to`, `message` and an
 * optional `from`, the key in the `apiKey` header. It answers 201 with one result per recipient;
 * only codes 100 to 102 mean the message is on its way.
 */
export class AfricasTalkingSmsProvider extends SmsProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AfricasTalkingOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async send(message: SmsMessage): Promise<void> {
    const form = new URLSearchParams({
      username: this.options.username,
      to: message.to,
      message: message.body,
      bulkSMSMode: '1',
    });
    if (this.options.senderId) form.set('from', this.options.senderId);
    const { status, json } = await post(
      'africastalking',
      this.fetchImpl,
      `${this.options.baseUrl.replace(/\/$/, '')}/version1/messaging`,
      {
        headers: {
          apiKey: this.options.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
      this.options.timeoutMs,
    );
    if (status < 200 || status >= 300) throw new SmsSendError('africastalking', `http-${status}`);
    const parsed = atAnswer.safeParse(json);
    const [recipient] = parsed.success ? parsed.data.SMSMessageData.Recipients : [];
    if (!recipient) throw new SmsSendError('africastalking', 'unexpected-answer');
    if (!AT_ACCEPTED.has(recipient.statusCode))
      throw new SmsSendError('africastalking', `status-${recipient.statusCode}`);
  }
}

// ---------------------------------------------------------------------------
// Routing by country calling code
// ---------------------------------------------------------------------------

/**
 * Picks the provider for each number by its longest matching calling-code prefix
 * (`SMS_ROUTES`, e.g. `234=termii,254=africastalking`), else the default (`SMS_PROVIDER`).
 */
export class RoutingSmsProvider extends SmsProvider {
  private readonly logger = new Logger(RoutingSmsProvider.name);
  private readonly prefixes: string[];

  constructor(
    private readonly fallback: { name: string; provider: SmsProvider },
    private readonly routes: ReadonlyMap<string, { name: string; provider: SmsProvider }>,
  ) {
    super();
    this.prefixes = [...routes.keys()].sort((a, b) => b.length - a.length);
  }

  /** The provider name a number goes to (for tests and the sandbox check). */
  route(to: string): string {
    return this.pick(to).name;
  }

  async send(message: SmsMessage): Promise<void> {
    const target = this.pick(message.to);
    try {
      await target.provider.send(message);
    } catch (error) {
      this.logger.warn(
        {
          provider: target.name,
          template: message.template,
          code: error instanceof SmsSendError ? error.code : (error as Error).name,
        },
        'sms send failed',
      );
      throw error;
    }
  }

  private pick(to: string): { name: string; provider: SmsProvider } {
    const digits = digitsOnly(to);
    const prefix = this.prefixes.find((candidate) => digits.startsWith(candidate));
    return (prefix ? this.routes.get(prefix) : undefined) ?? this.fallback;
  }
}
