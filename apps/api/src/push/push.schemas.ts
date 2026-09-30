import { z } from 'zod';

import { named } from '../contract/contract';
import { EXPO_PUSH_TOKEN } from '../notifications/push';

export const pushTokenRequestSchema = named(
  'PushTokenRequest',
  z.object({
    token: z
      .string()
      .regex(EXPO_PUSH_TOKEN, 'Use an Expo push token')
      .meta({ description: 'Expo push token from `getExpoPushTokenAsync` on the device.' }),
    platform: z.enum(['ios', 'android']),
  }),
);
export type PushTokenRequest = z.infer<typeof pushTokenRequestSchema>;

export const pushTokenPruneRunSchema = named(
  'PushTokenPruneRun',
  z.object({ deleted: z.number().int().min(0) }),
);
