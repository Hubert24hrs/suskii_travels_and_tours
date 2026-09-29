import { z } from 'zod';

import { emailSchema, localeCodeSchema, phoneSchema } from '@suskii/shared';

import { named } from '../contract/contract';

export const subscribeRequestSchema = named(
  'NewsletterSubscribeRequest',
  z.object({
    email: emailSchema,
    consent: z
      .literal(true)
      .meta({ description: 'The visitor ticked the deal-alert consent box (required).' }),
    whatsapp: z
      .object({ phone: phoneSchema })
      .optional()
      .meta({ description: 'Opt in to WhatsApp deal alerts (sent only once verified).' }),
    locale: localeCodeSchema.default('en-NG'),
    turnstileToken: z.string().min(1).max(2048),
  }),
);
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export const subscribeResponseSchema = named(
  'NewsletterSubscribeResponse',
  z.object({
    status: z
      .literal('pending_confirmation')
      .meta({ description: 'Always the same answer, whether or not the address is known.' }),
  }),
);

export const newsletterTokenRequestSchema = named(
  'NewsletterTokenRequest',
  z.object({ token: z.string().min(16).max(256) }),
);

export const newsletterConfirmResponseSchema = named(
  'NewsletterConfirmResponse',
  z.object({ status: z.literal('confirmed') }),
);

export const newsletterUnsubscribeResponseSchema = named(
  'NewsletterUnsubscribeResponse',
  z.object({ status: z.literal('unsubscribed') }),
);
