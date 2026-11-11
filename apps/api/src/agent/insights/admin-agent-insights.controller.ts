import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import type { AgentName } from '@suskii/shared';

import { staffActor } from '../../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../../auth/auth-context';
import { AdminRoute, StepUp } from '../../auth/decorators';
import { Contract } from '../../contract/contract';
import { AgentSettingsService } from '../agent-settings.service';

import {
  adminAgentConversationPageSchema,
  adminAgentConversationParamsSchema,
  adminAgentConversationQuerySchema,
  adminAgentConversationSchema,
  adminAgentCostSchema,
  adminAgentLimitsSchema,
  adminAgentParamsSchema,
  adminAgentQualitySchema,
  adminAgentRunPageSchema,
  adminAgentRunParamsSchema,
  adminAgentRunQuerySchema,
  adminAgentRunTraceSchema,
  adminAgentSwitchInputSchema,
  adminAgentSwitchSchema,
  adminAgentWindowQuerySchema,
  type AdminAgentConversation,
  type AdminAgentCost,
  type AdminAgentLimits,
  type AdminAgentQuality,
  type AdminAgentRunQuery,
  type AdminAgentRunTrace,
} from './agent-insights.schemas';
import { AgentInsightsService } from './agent-insights.service';

const TAGS = ['Admin'];

/**
 * What staff see of the assistant's work in the AI Control Center (ADR-105, ADR-107): runs
 * and their tool calls, travellers' conversations with contact details removed, cost, quality
 * and the limits in force; and the switch of a single agent.
 */
@Controller('admin/ai')
export class AdminAgentInsightsController {
  constructor(
    private readonly insights: AgentInsightsService,
    private readonly settings: AgentSettingsService,
  ) {}

  @Get('monitor/runs')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListAgentRuns',
    summary: 'Runs of the assistant, newest first',
    description:
      'Operations records: which agents and model worked, tokens, estimated cost, steps and how the run ended, as codes. Never what was said.',
    tags: TAGS,
    query: adminAgentRunQuerySchema,
    responses: { 200: adminAgentRunPageSchema },
    errors: [403],
  })
  runs(@Query() query: AdminAgentRunQuery): Promise<z.infer<typeof adminAgentRunPageSchema>> {
    return this.insights.runs(query);
  }

  @Get('monitor/runs/:runId')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentRunTrace',
    summary: 'One run with every tool it called',
    description:
      'Each call through the tool gateway in order: the tool, its tier, whether it ran or why it was refused, how long it took and the names of its arguments. Argument values and results are never stored.',
    tags: TAGS,
    params: adminAgentRunParamsSchema,
    responses: { 200: adminAgentRunTraceSchema },
    errors: [403, 404],
  })
  trace(@Param('runId') runId: string): Promise<AdminAgentRunTrace> {
    return this.insights.trace(runId);
  }

  @Get('monitor/conversations')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListAgentConversations',
    summary: "Travellers' conversations with the assistant, newest first",
    description:
      "Ids, channel, language and counts only. Staff members' own conversations with the staff agents are never listed.",
    tags: TAGS,
    query: adminAgentConversationQuerySchema,
    responses: { 200: adminAgentConversationPageSchema },
    errors: [403],
  })
  conversations(
    @Query() query: z.infer<typeof adminAgentConversationQuerySchema>,
  ): Promise<z.infer<typeof adminAgentConversationPageSchema>> {
    return this.insights.conversationList(query.cursor, query.limit);
  }

  @Get('monitor/conversations/:conversationId')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentConversationMasked',
    summary: "One traveller's conversation, with contact details removed",
    description:
      'The messages as the model saw them: email addresses, phone numbers, card-like and document-like numbers are removed. Every read is recorded in the audit log with the conversation id.',
    tags: TAGS,
    params: adminAgentConversationParamsSchema,
    responses: { 200: adminAgentConversationSchema },
    errors: [403, 404],
  })
  conversation(
    @CurrentAuth() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Req() request: Request,
  ): Promise<AdminAgentConversation> {
    return this.insights.conversation(conversationId, staffActor(auth, request));
  }

  @Get('cost')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentCost',
    summary: 'What the assistant cost, by day, agent, model, channel and account',
    description:
      "Estimates: the tokens the models reported at the configured prices. The provider's invoice is the actual cost. The month's forecast carries the spend so far to the month's end at the same daily rate.",
    tags: TAGS,
    query: adminAgentWindowQuerySchema,
    responses: { 200: adminAgentCostSchema },
    errors: [403],
  })
  cost(@Query() query: z.infer<typeof adminAgentWindowQuerySchema>): Promise<AdminAgentCost> {
    return this.insights.cost(query.days);
  }

  @Get('quality')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentQuality',
    summary: 'How answers fared: outcomes, handovers, refused answers, thumbs, per prompt version',
    tags: TAGS,
    query: adminAgentWindowQuerySchema,
    responses: { 200: adminAgentQualitySchema },
    errors: [403],
  })
  quality(@Query() query: z.infer<typeof adminAgentWindowQuerySchema>): Promise<AdminAgentQuality> {
    return this.insights.quality(query.days);
  }

  @Get('limits')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentLimits',
    summary: 'The limits and model prices the assistant runs under',
    description: 'Read from the configuration of this environment; changed in its settings.',
    tags: TAGS,
    responses: { 200: adminAgentLimitsSchema },
    errors: [403],
  })
  limits(): AdminAgentLimits {
    return this.insights.limits();
  }

  @Put('agents/:agent')
  @AdminRoute('ai:manage')
  @StepUp()
  @Contract({
    operationId: 'adminSwitchAgent',
    summary: 'Switch one agent off or back on',
    description:
      'An agent that is off is not offered to the router and its tools are refused. The concierge and the executive assistant, which answer when no other fits, cannot be switched off one by one (409 `agent-always-on`): the pause stops everything.',
    tags: TAGS,
    params: adminAgentParamsSchema,
    body: adminAgentSwitchInputSchema,
    responses: { 200: adminAgentSwitchSchema },
    errors: [403, 409],
    audit: ['agent.agent_switched'],
  })
  switchAgent(
    @CurrentAuth() auth: AuthContext,
    @Param('agent') agent: AgentName,
    @Body() body: z.infer<typeof adminAgentSwitchInputSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminAgentSwitchSchema>> {
    return this.settings.setAgentEnabled(agent, body.enabled, staffActor(auth, request));
  }
}
