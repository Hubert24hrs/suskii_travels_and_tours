import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';

import { AgentServiceRoute } from './agent-service-route';
import { AgentToolRegistry } from './agent-tool';
import {
  AgentToolGateway,
  type AgentToolAnswer,
  type AgentToolCall,
} from './agent-tool-gateway.service';
import {
  agentToolAnswerSchema,
  agentToolCallSchema,
  agentToolListSchema,
  agentToolParamsSchema,
} from './agent.schemas';

/**
 * The tool gateway (ADR-101): the agent service's only way to the platform. The edge blocks
 * `/v1/internal`, so these routes are reachable from inside the platform only.
 */
@AgentServiceRoute()
@Controller('internal/agent-tools')
export class InternalAgentToolsController {
  constructor(
    private readonly gateway: AgentToolGateway,
    private readonly registry: AgentToolRegistry,
  ) {}

  @Get()
  @Contract({
    operationId: 'listAgentTools',
    summary: 'The tools the gateway serves',
    description:
      'Name, description, tier, scope, the agents that may call each tool and the JSON Schema of its arguments. The agent service builds its tool list from this answer.',
    tags: ['Internal'],
    responses: { 200: agentToolListSchema },
    errors: [401, 404],
  })
  list(): z.infer<typeof agentToolListSchema> {
    return { tools: this.registry.describe() };
  }

  @Post(':tool')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'callAgentTool',
    summary: 'Run one tool for the caller of a sealed grant',
    description:
      "Decided in order: the assistant is on and not paused, the grant is valid for a running run, the run has calls left, the tool is this agent's, the grant opens its scope, the tier may run, the arguments fit. A refusal is a 200 with `status` and a `reason` code, so the model can react; a `commit` tool is always refused with `confirmation_required`.",
    tags: ['Internal'],
    params: agentToolParamsSchema,
    body: agentToolCallSchema,
    responses: { 200: agentToolAnswerSchema },
    errors: [401, 404],
  })
  call(@Param('tool') tool: string, @Body() body: AgentToolCall): Promise<AgentToolAnswer> {
    return this.gateway.call(tool, body);
  }
}
