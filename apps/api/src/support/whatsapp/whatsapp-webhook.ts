import { createHmac } from 'node:crypto';

import type { SupportDeliveryStatus, SupportMessageKind } from '@suskii/shared';
import { z } from 'zod';

import { safeEqual } from '../../crypto/random';

/**
 * Meta's webhook signature (ADR-084): `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the
 * exact request bytes under the app secret. Checked before anything is parsed.
 */
export function whatsappSignatureValid(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(header.slice('sha256='.length).toLowerCase(), expected);
}

/** A person's message as the support inbox needs it; vendor fields stay in this file. */
export interface WhatsAppInbound {
  /** WhatsApp's message id (`wamid`), unique per message. */
  messageId: string;
  /** Digits with the country code; null for a username user who hides their number. */
  phone: string | null;
  /** Business-scoped user id, when Meta sends one. */
  bsuid: string | null;
  sentAt: Date;
  kind: SupportMessageKind;
  /** The text, or for an unsupported message its WhatsApp type ("image", "audio", ...). */
  body: string;
}

export interface WhatsAppDeliveryUpdate {
  messageId: string;
  status: Exclude<SupportDeliveryStatus, 'pending'>;
  /** Meta's error code for a failure (`meta-131047`), never its message. */
  error: string | null;
}

export interface WhatsAppDelivery {
  /** The business number the delivery is for (`metadata.phone_number_id`). */
  phoneNumberId: string | null;
  messages: WhatsAppInbound[];
  statuses: WhatsAppDeliveryUpdate[];
}

/** WhatsApp's longest text message; longer bodies are cut, never refused. */
const TEXT_MAX = 4_096;
const digits = z.string().regex(/^\d{6,20}$/);
const id = z.string().min(1).max(255);
const unixSeconds = z.string().regex(/^\d{1,12}$/);

const contactSchema = z.looseObject({ wa_id: digits.optional(), user_id: id.optional() });
const messageSchema = z.looseObject({
  id,
  from: digits.optional(),
  from_user_id: id.optional(),
  timestamp: unixSeconds,
  type: z.string().regex(/^[a-z_]{1,40}$/),
  text: z.looseObject({ body: z.string() }).optional(),
});
const statusSchema = z.looseObject({
  id,
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  errors: z.array(z.looseObject({ code: z.union([z.number(), z.string()]).optional() })).optional(),
});
const valueSchema = z.looseObject({
  metadata: z.looseObject({ phone_number_id: z.string().max(40) }).optional(),
  contacts: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});
const payloadSchema = z.looseObject({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.looseObject({
        changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })).default([]),
      }),
    )
    .default([]),
});

/**
 * Reads a verified delivery. Each message and status is parsed on its own, so one odd item never
 * drops the others; anything that is not a `messages` change is ignored.
 */
export function parseWhatsAppDelivery(json: unknown): WhatsAppDelivery[] {
  const payload = payloadSchema.safeParse(json);
  if (!payload.success) return [];
  const deliveries: WhatsAppDelivery[] = [];
  for (const entry of payload.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) continue;
      const contacts = (value.data.contacts ?? []).flatMap((item) => {
        const parsed = contactSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
      const messages = (value.data.messages ?? []).flatMap((item): WhatsAppInbound[] => {
        const parsed = messageSchema.safeParse(item);
        if (!parsed.success) return [];
        const message = parsed.data;
        // The sender's contact entry: by number when there is one, else the only entry.
        const contact =
          contacts.find((entry) => message.from && entry.wa_id === message.from) ??
          (contacts.length === 1 ? contacts[0] : undefined);
        const phone = message.from ?? contact?.wa_id ?? null;
        const bsuid = message.from_user_id ?? contact?.user_id ?? null;
        if (!phone && !bsuid) return [];
        const text = message.type === 'text' ? message.text?.body.trim() : undefined;
        if (message.type === 'text' && !text) return [];
        return [
          {
            messageId: message.id,
            phone,
            bsuid,
            sentAt: new Date(Number(message.timestamp) * 1000),
            ...(text
              ? { kind: 'text' as const, body: text.slice(0, TEXT_MAX) }
              : { kind: 'unsupported' as const, body: message.type }),
          },
        ];
      });
      const statuses = (value.data.statuses ?? []).flatMap((item): WhatsAppDeliveryUpdate[] => {
        const parsed = statusSchema.safeParse(item);
        if (!parsed.success) return [];
        const code = parsed.data.errors?.[0]?.code;
        return [
          {
            messageId: parsed.data.id,
            status: parsed.data.status,
            error: parsed.data.status === 'failed' ? `meta-${code ?? 'unknown'}` : null,
          },
        ];
      });
      deliveries.push({
        phoneNumberId: value.data.metadata?.phone_number_id ?? null,
        messages,
        statuses,
      });
    }
  }
  return deliveries;
}
