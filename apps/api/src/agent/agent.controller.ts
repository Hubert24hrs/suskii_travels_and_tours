import { Controller, Get, Header } from '@nestjs/common';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { AgentFlags } from './agent-flags';
import { AgentPause } from './agent-pause';
import { agentStatusSchema } from './agent.schemas';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly flags: AgentFlags,
    private readonly pause: AgentPause,
  ) {}

  @Get('status')
  @Public()
  // A pause must show within seconds, so nothing may keep this answer.
  @Header('Cache-Control', 'no-store')
  @Contract({
    operationId: 'getAgentStatus',
    summary: 'Whether the assistant can be offered',
    description:
      'Clients show the assistant only while `available` is true and hide it when this cannot be read. Search, booking and payment never depend on it.',
    tags: ['Assistant'],
    responses: { 200: agentStatusSchema },
  })
  async status(): Promise<z.infer<typeof agentStatusSchema>> {
    const enabled = this.flags.enabled();
    // Nothing is asked of Redis while the assistant is off.
    const paused = enabled ? await this.pause.paused() : false;
    return { enabled, paused, available: enabled && !paused && this.flags.configured() };
  }
}
