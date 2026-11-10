import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { ProblemDetailsException } from '../common/problem-details';
import { Contract } from '../contract/contract';

import { AgentAdminService } from './agent-admin.service';
import { AgentSettingsService, type AutonomySetting } from './agent-settings.service';
import {
  adminAgentOverviewSchema,
  agentAutonomyInputSchema,
  agentAutonomySettingSchema,
  agentPauseInputSchema,
  type AdminAgentOverview,
  type AgentAutonomyInput,
  type AgentPauseInput,
} from './agent.schemas';

const TAGS = ['Admin'];
const pauseStateSchema = adminAgentOverviewSchema.shape.pause;
type PauseState = z.infer<typeof pauseStateSchema>;

/** The AI Control Center's switches (ADR-107). */
@Controller('admin/ai')
export class AdminAgentController {
  constructor(
    private readonly admin: AgentAdminService,
    private readonly settings: AgentSettingsService,
  ) {}

  @Get('overview')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentOverview',
    summary: 'The assistant at a glance',
    description:
      "Whether it is on, configured and paused, today's model spend against the daily cap, run counts, the autonomy level of every agent and tool, and the tools the gateway serves.",
    tags: TAGS,
    responses: { 200: adminAgentOverviewSchema },
    errors: [403],
  })
  overview(): Promise<AdminAgentOverview> {
    return this.admin.overview();
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:manage')
  @Contract({
    operationId: 'adminPauseAgent',
    summary: 'Pause the assistant everywhere',
    description:
      'Takes effect within seconds: no run starts and no tool runs. Clients fall back to the ordinary screens. Needs no second check, so it is one press in an incident.',
    tags: TAGS,
    body: agentPauseInputSchema,
    responses: { 200: pauseStateSchema },
    errors: [403, 409],
    audit: ['agent.paused'],
  })
  pause(
    @CurrentAuth() auth: AuthContext,
    @Body() body: AgentPauseInput,
    @Req() request: Request,
  ): Promise<PauseState> {
    return this.admin.pause(body.reason, staffActor(auth, request));
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:manage')
  @StepUp()
  @Contract({
    operationId: 'adminResumeAgent',
    summary: 'Release the pause',
    tags: TAGS,
    responses: { 200: pauseStateSchema },
    errors: [403, 409],
    audit: ['agent.resumed'],
  })
  resume(@CurrentAuth() auth: AuthContext, @Req() request: Request): Promise<PauseState> {
    return this.admin.resume(staffActor(auth, request));
  }

  @Put('autonomy')
  @AdminRoute('ai:manage')
  @StepUp()
  @Contract({
    operationId: 'adminSetAgentAutonomy',
    summary: 'Set how far an agent or a tool goes without a person',
    description:
      "`manual`: advice only. `supervised` (the default): prepares, a person approves. `autonomous`: approved low-risk tools within limits. A call runs at the stricter of its agent's and its tool's level; a `commit` still needs the traveller's tap at every level.",
    tags: TAGS,
    body: agentAutonomyInputSchema,
    responses: { 200: agentAutonomySettingSchema },
    errors: [403, 404, 409],
    audit: ['agent.autonomy_changed'],
  })
  setAutonomy(
    @CurrentAuth() auth: AuthContext,
    @Body() body: AgentAutonomyInput,
    @Req() request: Request,
  ): Promise<AutonomySetting> {
    if (!this.settings.known(body.subject, body.name)) {
      throw new ProblemDetailsException(
        HttpStatus.NOT_FOUND,
        'agent-subject-not-found',
        'No such agent or tool',
      );
    }
    return this.settings.setAutonomy(body, staffActor(auth, request));
  }
}
