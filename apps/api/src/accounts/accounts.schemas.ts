import { z } from 'zod';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  notificationPreferencesInputSchema,
  preferencesInputSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';

const timestamp = z.iso.datetime();

export const preferencesSchema = named(
  'AccountPreferences',
  z.object({
    locale: z.string().nullable(),
    currency: z.string().length(3).nullable(),
    homeAirport: z.string().length(3).nullable(),
    marketingConsent: z.boolean(),
    marketingConsentAt: timestamp.nullable(),
  }),
);
export type PreferencesDto = z.infer<typeof preferencesSchema>;

export const updatePreferencesBodySchema = named(
  'UpdatePreferencesRequest',
  preferencesInputSchema,
);

export const notificationPreferenceSchema = named(
  'NotificationPreference',
  z.object({
    category: z.enum(NOTIFICATION_CATEGORIES),
    channel: z.enum(NOTIFICATION_CHANNELS),
    enabled: z.boolean(),
    mandatory: z.boolean().describe('Booking and payment email cannot be turned off.'),
  }),
);

export const notificationPreferencesSchema = named(
  'NotificationPreferences',
  z.object({
    preferences: z.array(notificationPreferenceSchema),
    phoneVerified: z
      .boolean()
      .describe('SMS and WhatsApp are only sent to a verified phone number.'),
    marketingConsent: z.boolean(),
  }),
);
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesBodySchema = named(
  'UpdateNotificationPreferencesRequest',
  notificationPreferencesInputSchema,
);
