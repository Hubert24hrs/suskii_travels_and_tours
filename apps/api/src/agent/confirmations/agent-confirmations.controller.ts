import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext, type AuthenticatedRequest } from '../../auth/auth-context';
import { requestContext } from '../../common/request-context';
import { Contract } from '../../contract/contract';
import { AGENT_LIMITS, RateLimit } from '../../rate-limit/rate-limit.decorator';
import { AgentFlags } from '../agent-flags';

import {
  agentConfirmationParamsSchema,
  agentConfirmationSchema,
  decidedAgentConfirmationSchema,
} from './agent-confirmations.schemas';
import { AgentConfirmationsService } from './agent-confirmations.service';

const TAGS = ['Assistant'];

/**
 * The traveller's side of a confirmation (ADR-107): read the card the API built, then confirm
 * or decline. These routes take a session, never a grant, so an agent cannot call them; only
 * the conversation's owner sees a confirmation, and anyone else gets 404.
 */
@Controller('agent/confirmations')
export class AgentConfirmationsController {
  constructor(
    private readonly confirmations: AgentConfirmationsService,
    private readonly flags: AgentFlags,
  ) {}

  @Get(':confirmationId')
  @RateLimit(AGENT_LIMITS.readIp)
  @Contract({
    operationId: 'getAgentConfirmation',
    summary: 'What the assistant asks the traveller to confirm',
    description:
      'The card is built by the API from its own records: what will be done, to which booking or trip, and the money it moves. `status` is `pending` until the traveller answers or 15 minutes pass.',
    tags: TAGS,
    params: agentConfirmationParamsSchema,
    responses: { 200: agentConfirmationSchema },
    errors: [404],
  })
  get(
    @Param('confirmationId') confirmationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<z.infer<typeof agentConfirmationSchema>> {
    this.flags.require();
    return this.confirmations.get(confirmationId, auth.userId);
  }

  @Post(':confirmationId/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(AGENT_LIMITS.messageIp)
  @Contract({
    operationId: 'confirmAgentConfirmation',
    summary: "The traveller's tap: do what the card says",
    description:
      'Runs the action through the ordinary service as the signed-in traveller, exactly as the card showed it (a refund that changed since is refused, and `status` becomes `failed` with a `reason`). The assistant then says what the records hold in the run named by `runId`. 409 `confirmation-decided` or `confirmation-expired` when it is no longer waiting.',
    tags: TAGS,
    params: agentConfirmationParamsSchema,
    responses: { 202: decidedAgentConfirmationSchema },
    errors: [404, 409, 503],
    idempotent: true,
  })
  confirm(
    @Param('confirmationId') confirmationId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof decidedAgentConfirmationSchema>> {
    this.flags.require();
    return this.confirmations.decide(confirmationId, 'confirm', {
      userId: auth.userId,
      roles: auth.roles,
      context: requestContext(request),
    });
  }

  @Post(':confirmationId/decline')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(AGENT_LIMITS.messageIp)
  @Contract({
    operationId: 'declineAgentConfirmation',
    summary: 'The traveller says no',
    description:
      'Nothing is done. The assistant is told and answers in the run named by `runId`. 409 when the confirmation is no longer waiting.',
    tags: TAGS,
    params: agentConfirmationParamsSchema,
    responses: { 202: decidedAgentConfirmationSchema },
    errors: [404, 409, 503],
  })
  decline(
    @Param('confirmationId') confirmationId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof decidedAgentConfirmationSchema>> {
    this.flags.require();
    return this.confirmations.decide(confirmationId, 'decline', {
      userId: auth.userId,
      roles: auth.roles,
      context: requestContext(request),
    });
  }
}
