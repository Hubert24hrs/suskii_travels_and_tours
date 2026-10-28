import { Injectable } from '@nestjs/common';
import { z } from 'zod';

/** A WhatsApp send that Meta refused or that did not finish; `code` is safe to store and show. */
export class WhatsAppSendError extends Error {
  constructor(readonly code: string) {
    super(`WhatsApp send failed: ${code}`);
    this.name = 'WhatsAppSendError';
  }
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  /** Body parameters in order ({{1}}, {{2}}, ...). */
  parameters: string[];
}

/**
 * Sending on WhatsApp (ADR-084). Replies go to a phone number (digits with the country code);
 * the answer is WhatsApp's message id (`wamid`), which status webhooks refer to later.
 */
export abstract class WhatsAppChannel {
  abstract sendText(to: string, body: string, signal: AbortSignal): Promise<{ messageId: string }>;
  abstract sendTemplate(
    to: string,
    template: WhatsAppTemplate,
    signal: AbortSignal,
  ): Promise<{ messageId: string }>;
}

export type WhatsAppOutboxEntry =
  | { kind: 'text'; to: string; body: string; messageId: string }
  | { kind: 'template'; to: string; template: WhatsAppTemplate; messageId: string };

/** Keeps sends in memory for tests and local stacks; production refuses it. */
@Injectable()
export class MockWhatsAppChannel extends WhatsAppChannel {
  readonly outbox: WhatsAppOutboxEntry[] = [];
  /** Tests set a code to make the next sends fail as Meta would. */
  failWith: string | null = null;
  private sequence = 0;

  sendText(to: string, body: string): Promise<{ messageId: string }> {
    return this.record((messageId) => ({ kind: 'text', to, body, messageId }));
  }

  sendTemplate(to: string, template: WhatsAppTemplate): Promise<{ messageId: string }> {
    return this.record((messageId) => ({ kind: 'template', to, template, messageId }));
  }

  private record(
    entry: (messageId: string) => WhatsAppOutboxEntry,
  ): Promise<{ messageId: string }> {
    if (this.failWith) return Promise.reject(new WhatsAppSendError(this.failWith));
    this.sequence += 1;
    const messageId = `wamid.mock-${Date.now().toString(36)}-${this.sequence}`;
    this.outbox.push(entry(messageId));
    return Promise.resolve({ messageId });
  }
}

export interface CloudWhatsAppOptions {
  /** Graph API base with its version, e.g. https://graph.facebook.com/v26.0. */
  baseUrl: string;
  phoneNumberId: string;
  accessToken: string;
  fetch?: typeof fetch;
}

const sentSchema = z.looseObject({
  messages: z.array(z.looseObject({ id: z.string().min(1).max(255) })).min(1),
});
const errorSchema = z.looseObject({
  error: z.looseObject({ code: z.union([z.number(), z.string()]).optional() }),
});

/**
 * The WhatsApp Cloud API: `POST /{phone number id}/messages` with the token in the
 * Authorization header (never the URL). Errors keep Meta's numeric code only, because error
 * bodies can echo the message.
 */
export class CloudWhatsAppChannel extends WhatsAppChannel {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CloudWhatsAppOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  sendText(to: string, body: string, signal: AbortSignal): Promise<{ messageId: string }> {
    // No link previews: a reply may quote a link the traveller sent, and previews fetch it.
    return this.post({ to, type: 'text', text: { body, preview_url: false } }, signal);
  }

  sendTemplate(
    to: string,
    template: WhatsAppTemplate,
    signal: AbortSignal,
  ): Promise<{ messageId: string }> {
    return this.post(
      {
        to,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          components: template.parameters.length
            ? [
                {
                  type: 'body',
                  parameters: template.parameters.map((text) => ({ type: 'text', text })),
                },
              ]
            : [],
        },
      },
      signal,
    );
  }

  private async post(
    message: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.options.baseUrl}/${encodeURIComponent(this.options.phoneNumberId)}/messages`,
        {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            Authorization: `Bearer ${this.options.accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            ...message,
          }),
        },
      );
    } catch {
      throw new WhatsAppSendError(signal.aborted ? 'timeout' : 'network');
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      const code = parsed.success ? parsed.data.error.code : undefined;
      throw new WhatsAppSendError(code === undefined ? `http-${response.status}` : `meta-${code}`);
    }
    const sent = sentSchema.safeParse(json);
    const [first] = sent.success ? sent.data.messages : [];
    if (!first) throw new WhatsAppSendError('unexpected-answer');
    return { messageId: first.id };
  }
}
