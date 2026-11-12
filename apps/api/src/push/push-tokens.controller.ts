import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';
import { DEVICE_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { PushTokensService } from './push-tokens.service';
import { pushTokenPruneRunSchema, pushTokenRequestSchema } from './push.schemas';

/** This device's push token for the signed-in account, tied to the current session (ADR-022). */
@Controller('me/push-token')
export class MePushTokenController {
  constructor(private readonly tokens: PushTokensService) {}

  @Put()
  @RateLimit(DEVICE_LIMITS.pushTokenIp)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'registerPushToken',
    summary: 'Receive booking pushes on this device',
    description:
      'Registers the device for pushes about the account bookings while this session lasts. Signing out or revoking the session stops them.',
    tags: ['Account'],
    body: pushTokenRequestSchema,
    responses: { 204: null },
  })
  async register(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof pushTokenRequestSchema>,
  ): Promise<void> {
    await this.tokens.registerForSession(auth.sessionId, auth.userId, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'unregisterPushToken',
    summary: 'Stop account pushes on this device',
    tags: ['Account'],
    responses: { 204: null },
  })
  async unregister(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.tokens.unregisterSession(auth.sessionId);
  }
}

/** Worker-only: removes push tokens nobody should reach any more. */
@InternalRoute()
@Controller('internal/push-tokens')
export class InternalPushTokensController {
  constructor(private readonly tokens: PushTokensService) {}

  @Post('prune')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'prunePushTokens',
    summary: 'Delete push tokens of ended sessions, closed bookings and stale devices',
    tags: ['Internal'],
    responses: { 200: pushTokenPruneRunSchema },
  })
  prune(): Promise<z.infer<typeof pushTokenPruneRunSchema>> {
    return this.tokens.prune();
  }
}
