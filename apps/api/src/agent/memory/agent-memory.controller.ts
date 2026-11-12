import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import type { AgentMemoryKey } from '@suskii/shared';

import { CurrentAuth, type AuthContext } from '../../auth/auth-context';
import { requestContext } from '../../common/request-context';
import { Contract } from '../../contract/contract';
import { AgentFlags } from '../agent-flags';

import {
  agentMemoryKeyParamsSchema,
  agentMemorySchema,
  agentMemorySwitchSchema,
  agentMemoryValueSchema,
  type AgentMemoryDto,
} from './agent-memory.schemas';
import { AgentMemoryService } from './agent-memory.service';

const TAGS = ['Assistant'];

/**
 * What the assistant remembers about the signed-in traveller (ADR-105): theirs to switch on,
 * read, change and erase. 404 while the assistant is switched off, like its other routes.
 */
@Controller('me/assistant-memory')
export class AgentMemoryController {
  constructor(
    private readonly memory: AgentMemoryService,
    private readonly flags: AgentFlags,
  ) {}

  @Get()
  @Contract({
    operationId: 'getAssistantMemory',
    summary: 'What the assistant remembers about me',
    description:
      'A short list of travel preferences (home airport, cabin, seat, preferred airlines, how to weigh price against comfort), kept only while `enabled` is true. Never free text and never a meal preference.',
    tags: TAGS,
    responses: { 200: agentMemorySchema },
    errors: [404],
  })
  get(@CurrentAuth() auth: AuthContext): Promise<AgentMemoryDto> {
    this.flags.require();
    return this.memory.get(auth.userId);
  }

  @Put()
  @Contract({
    operationId: 'setAssistantMemory',
    summary: 'Let the assistant remember my preferences, or stop it',
    description: 'Turning it off erases everything it remembered.',
    tags: TAGS,
    body: agentMemorySwitchSchema,
    responses: { 200: agentMemorySchema },
    errors: [404],
  })
  set(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof agentMemorySwitchSchema>,
    @Req() request: Request,
  ): Promise<AgentMemoryDto> {
    this.flags.require();
    return this.memory.setEnabled(auth.userId, body.enabled, requestContext(request));
  }

  @Put(':key')
  @Contract({
    operationId: 'rememberAssistantPreference',
    summary: 'Set one remembered preference',
    description:
      '409 `agent-memory-off` until remembering is switched on. 422 `agent-memory-invalid` for a value the preference does not take, or a code that names no airport or airline.',
    tags: TAGS,
    params: agentMemoryKeyParamsSchema,
    body: agentMemoryValueSchema,
    responses: { 200: agentMemorySchema },
    errors: [404, 409, 422],
  })
  put(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: AgentMemoryKey,
    @Body() body: z.infer<typeof agentMemoryValueSchema>,
  ): Promise<AgentMemoryDto> {
    this.flags.require();
    return this.memory.put(auth.userId, key, body.value, 'traveller');
  }

  @Delete(':key')
  @Contract({
    operationId: 'forgetAssistantPreference',
    summary: 'Erase one remembered preference',
    tags: TAGS,
    params: agentMemoryKeyParamsSchema,
    responses: { 200: agentMemorySchema },
    errors: [404],
  })
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: AgentMemoryKey,
  ): Promise<AgentMemoryDto> {
    this.flags.require();
    return this.memory.remove(auth.userId, key);
  }
}
