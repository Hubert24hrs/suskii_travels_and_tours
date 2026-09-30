import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

/** Expo push tokens as returned by `getExpoPushTokenAsync` on the device. */
export const EXPO_PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/;

export interface PushMessage {
  /** Device push token (decrypted for sending only; never logged). */
  to: string;
  title: string;
  body: string;
  /** In-app path the app opens when the notification is tapped, e.g. `/trips/{id}`. */
  path: string;
}

/** Outcome per message, in order: `invalid-token` means the token should be deleted. */
export type PushResult = 'ok' | 'invalid-token' | 'error';

/** Push delivery behind an interface (ADR-022); Expo relays to FCM and APNs. */
export abstract class PushProvider {
  abstract send(messages: PushMessage[]): Promise<PushResult[]>;
}

const ticketSchema = z.union([
  z.object({ status: z.literal('ok'), id: z.string() }),
  z.object({
    status: z.literal('error'),
    message: z.string().optional(),
    details: z.object({ error: z.string().optional() }).optional(),
  }),
]);
const responseSchema = z.object({ data: z.array(ticketSchema) });

/** Expo accepts at most 100 messages per request. */
const CHUNK = 100;

export interface ExpoPushOptions {
  url: string;
  accessToken?: string | undefined;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/**
 * Expo push service (`/--/api/v2/push/send`). Messages go to the `bookings` Android channel with
 * high priority. A failed request marks its chunk as `error`; `DeviceNotRegistered` tickets mark
 * the token as invalid. Delivery receipts are not polled (ADR-022).
 */
export class ExpoPushProvider extends PushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: ExpoPushOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const results: PushResult[] = [];
    for (let start = 0; start < messages.length; start += CHUNK) {
      results.push(...(await this.sendChunk(messages.slice(start, start + CHUNK))));
    }
    return results;
  }

  private async sendChunk(messages: PushMessage[]): Promise<PushResult[]> {
    const failed = messages.map((): PushResult => 'error');
    try {
      const response = await this.fetchImpl(this.options.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.options.accessToken
            ? { Authorization: `Bearer ${this.options.accessToken}` }
            : {}),
        },
        body: JSON.stringify(
          messages.map((message) => ({
            to: message.to,
            title: message.title,
            body: message.body,
            data: { path: message.path },
            channelId: 'bookings',
            priority: 'high',
            sound: 'default',
          })),
        ),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'expo push request failed');
        return failed;
      }
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.data.length !== messages.length) {
        this.logger.warn('expo push response not understood');
        return failed;
      }
      return parsed.data.data.map((ticket): PushResult => {
        if (ticket.status === 'ok') return 'ok';
        const code = ticket.details?.error ?? 'unknown';
        if (code === 'DeviceNotRegistered') return 'invalid-token';
        this.logger.warn({ code }, 'expo push ticket error');
        return 'error';
      });
    } catch (error) {
      this.logger.warn({ reason: (error as Error).name }, 'expo push unavailable');
      return failed;
    }
  }
}

/**
 * Development and tests: keeps messages in memory. Tokens listed in `unregistered` answer
 * `invalid-token`, like a device that uninstalled the app.
 */
@Injectable()
export class MockPushProvider extends PushProvider {
  private readonly logger = new Logger(MockPushProvider.name);
  readonly outbox: PushMessage[] = [];
  readonly unregistered = new Set<string>();

  send(messages: PushMessage[]): Promise<PushResult[]> {
    return Promise.resolve(
      messages.map((message): PushResult => {
        if (this.unregistered.has(message.to)) return 'invalid-token';
        this.outbox.push(message);
        this.logger.log({ path: message.path }, 'push captured by mock provider');
        return 'ok';
      }),
    );
  }
}
