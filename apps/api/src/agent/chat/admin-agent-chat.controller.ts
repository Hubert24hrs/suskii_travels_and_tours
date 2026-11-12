import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../../admin/admin-helpers';
import { AuditService } from '../../audit/audit.service';
import { CurrentAuth, type AuthContext } from '../../auth/auth-context';
import { AdminRoute } from '../../auth/decorators';
import { Contract } from '../../contract/contract';
import { AGENT_LIMITS, RateLimit } from '../../rate-limit/rate-limit.decorator';
import { AgentFlags } from '../agent-flags';

import {
  agentChatRequestSchema,
  agentChatStartedSchema,
  agentConversationParamsSchema,
  agentConversationSchema,
  agentRunParamsSchema,
  agentRunQuerySchema,
  agentRunSchema,
  startStaffAgentConversationSchema,
} from './agent-chat.schemas';
import { AgentChatService } from './agent-chat.service';
import { AgentConversationsService } from './agent-conversations.service';

const TAGS = ['Admin'];

/**
 * The staff agents in the console (ADR-107): operations, finance preparation, marketing,
 * business intelligence, price intelligence and the executive assistant. A staff member talks
 * to the agents their own permissions open, and an agent reads only what that person may read.
 * It decides nothing: what it prepares waits in the approvals queue for someone else.
 */
@Controller('admin/ai')
export class AdminAgentChatController {
  constructor(
    private readonly conversations: AgentConversationsService,
    private readonly chat: AgentChatService,
    private readonly flags: AgentFlags,
    private readonly audit: AuditService,
  ) {}

  @Post('conversations')
  @AdminRoute('ai:read')
  @RateLimit(AGENT_LIMITS.startIp)
  @Contract({
    operationId: 'adminStartAgentConversation',
    summary: 'Start a conversation with the staff agents',
    tags: TAGS,
    body: startStaffAgentConversationSchema,
    responses: { 201: agentConversationSchema },
    errors: [403, 404, 409],
    audit: ['agent.staff_conversation_started'],
  })
  async start(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof startStaffAgentConversationSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof agentConversationSchema>> {
    this.flags.require();
    const conversation = await this.conversations.startForStaff(auth.userId, body.locale);
    await this.audit.record({
      action: 'agent.staff_conversation_started',
      actorUserId: auth.userId,
      targetType: 'agent_conversation',
      targetId: conversation.id,
      context: staffActor(auth, request).context,
    });
    return conversation;
  }

  @Get('conversations/:conversationId')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentConversation',
    summary: "One of the staff member's own conversations, with its messages",
    tags: TAGS,
    params: agentConversationParamsSchema,
    responses: { 200: agentConversationSchema },
    errors: [403, 404],
  })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<z.infer<typeof agentConversationSchema>> {
    this.flags.require();
    return this.conversations.getForStaff(conversationId, auth.userId);
  }

  @Post('chat')
  @HttpCode(HttpStatus.ACCEPTED)
  @AdminRoute('ai:read')
  @RateLimit(AGENT_LIMITS.messageIp)
  @Contract({
    operationId: 'adminSendAgentMessage',
    summary: 'Ask the staff agents something',
    description:
      "Answers 202 with the run to read (`GET /v1/admin/ai/runs/{runId}`). The agents that may answer are the ones whose part of the platform the caller's own permissions open; with none, 403. What an agent prepares (a refund request, a promo code) waits in the approvals queue for someone else to decide.",
    tags: TAGS,
    body: agentChatRequestSchema,
    responses: { 202: agentChatStartedSchema },
    errors: [403, 404, 409, 429, 503],
    audit: ['agent.staff_message_sent'],
  })
  async send(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof agentChatRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof agentChatStartedSchema>> {
    this.flags.require();
    const started = await this.chat.sendForStaff(body.conversationId, body.text, {
      userId: auth.userId,
      roles: auth.roles,
    });
    // That a question was asked, of which conversation, in which run: never its words.
    await this.audit.record({
      action: 'agent.staff_message_sent',
      actorUserId: auth.userId,
      targetType: 'agent_conversation',
      targetId: body.conversationId,
      context: staffActor(auth, request).context,
      metadata: { runId: started.runId },
    });
    return started;
  }

  @Get('runs/:runId')
  @AdminRoute('ai:read')
  @RateLimit(AGENT_LIMITS.readIp)
  @Contract({
    operationId: 'adminGetAgentRun',
    summary: "The events of one of the staff member's own runs",
    tags: TAGS,
    params: agentRunParamsSchema,
    query: agentRunQuerySchema,
    responses: { 200: agentRunSchema },
    errors: [403, 404],
  })
  run(
    @CurrentAuth() auth: AuthContext,
    @Param('runId') runId: string,
    @Query() query: z.infer<typeof agentRunQuerySchema>,
  ): Promise<z.infer<typeof agentRunSchema>> {
    this.flags.require();
    return this.chat.eventsForStaff(runId, query.after, auth.userId);
  }
}
