import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext, type AuthenticatedRequest } from '../auth/auth-context';
import { Contract } from '../contract/contract';
import { clientContext } from '../search/client-context';

import {
  notificationPreferencesSchema,
  preferencesSchema,
  updateNotificationPreferencesBodySchema,
  updatePreferencesBodySchema,
} from './accounts.schemas';
import { PreferencesService } from './preferences.service';

const TAGS = ['Account'];

/** Where a consent came from: the client channel, recorded with the time (ADR-032). */
const consentSource = (request: AuthenticatedRequest): string =>
  `account:${clientContext(request).channel ?? 'api'}`;

/** The signed-in user's settings and notification choices (ADR-032). */
@Controller('me')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get('preferences')
  @Contract({
    operationId: 'getPreferences',
    summary: 'Language, currency, home airport and marketing consent',
    tags: TAGS,
    responses: { 200: preferencesSchema },
  })
  get(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof preferencesSchema>> {
    return this.preferences.get(auth.userId);
  }

  @Patch('preferences')
  @Contract({
    operationId: 'updatePreferences',
    summary: 'Change preferences',
    description:
      'Fields left out stay as they are; `null` clears one. Withdrawing marketing consent turns off every marketing channel.',
    tags: TAGS,
    body: updatePreferencesBodySchema,
    responses: { 200: preferencesSchema },
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof updatePreferencesBodySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof preferencesSchema>> {
    return this.preferences.update(auth.userId, body, consentSource(request));
  }

  @Get('notification-preferences')
  @Contract({
    operationId: 'getNotificationPreferences',
    summary: 'Which messages arrive on which channel',
    tags: TAGS,
    responses: { 200: notificationPreferencesSchema },
  })
  notifications(
    @CurrentAuth() auth: AuthContext,
  ): Promise<z.infer<typeof notificationPreferencesSchema>> {
    return this.preferences.notifications(auth.userId);
  }

  @Patch('notification-preferences')
  @Contract({
    operationId: 'updateNotificationPreferences',
    summary: 'Turn channels on or off per category',
    description:
      'Booking and payment email cannot be turned off (422). Turning on a marketing channel records marketing consent.',
    tags: TAGS,
    body: updateNotificationPreferencesBodySchema,
    responses: { 200: notificationPreferencesSchema },
    errors: [422],
  })
  updateNotifications(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof updateNotificationPreferencesBodySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof notificationPreferencesSchema>> {
    return this.preferences.updateNotifications(auth.userId, body.changes, consentSource(request));
  }
}
