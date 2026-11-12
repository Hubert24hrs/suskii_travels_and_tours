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
import { CurrentAuth, type AuthContext } from '../../auth/auth-context';
import { AdminRoute } from '../../auth/decorators';
import { Contract } from '../../contract/contract';
import { PrismaService } from '../../infra/prisma.service';

import {
  agentApprovalListSchema,
  agentApprovalParamsSchema,
  agentApprovalQuerySchema,
  agentApprovalSchema,
  rejectAgentApprovalSchema,
} from './agent-approvals.schemas';
import { AgentApprovalsService, type ApprovalDecider } from './agent-approvals.service';

const TAGS = ['Admin'];
type Approval = z.infer<typeof agentApprovalSchema>;

const decider = (auth: AuthContext, request: Request): ApprovalDecider => ({
  ...staffActor(auth, request),
  roles: auth.roles,
});

/**
 * The approvals queue in the console (ADR-107): what staff agents prepared, for a person to
 * decide. These routes take a staff session with MFA; no agent has a way to call them, and the
 * person whose question produced a proposal cannot decide it.
 */
@Controller('admin/ai/approvals')
export class AdminAgentApprovalsController {
  constructor(
    private readonly approvals: AgentApprovalsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListAgentApprovals',
    summary: 'What agents prepared for a person to decide, oldest first',
    description:
      '`alsoWaiting` counts the assisted quotes to verify and the paid bookings to book by hand, which are decided on their own page (`/v1/admin/assisted-quotes`).',
    tags: TAGS,
    query: agentApprovalQuerySchema,
    responses: { 200: agentApprovalListSchema },
    errors: [403],
  })
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: z.infer<typeof agentApprovalQuerySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof agentApprovalListSchema>> {
    const [approvals, toVerify, toBook] = await Promise.all([
      this.approvals.list(query.status, query.limit, decider(auth, request)),
      // Counted whether or not assisted quotes are still offered: what waits, waits.
      this.prisma.assistedQuote.count({ where: { status: 'requested' } }),
      this.prisma.bookingItem.count({
        where: {
          type: 'assisted',
          bookedAt: null,
          booking: { status: { in: ['PAID', 'TICKETING'] } },
        },
      }),
    ]);
    return {
      approvals,
      alsoWaiting: { assistedQuotesToVerify: toVerify, assistedBookingsToBook: toBook },
    };
  }

  @Get(':approvalId')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetAgentApproval',
    summary: 'One proposal, with exactly what approving it would do',
    tags: TAGS,
    params: agentApprovalParamsSchema,
    responses: { 200: agentApprovalSchema },
    errors: [403, 404],
  })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('approvalId') id: string,
    @Req() request: Request,
  ): Promise<Approval> {
    return this.approvals.get(id, decider(auth, request));
  }

  @Post(':approvalId/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:approve')
  @Contract({
    operationId: 'adminApproveAgentApproval',
    summary: 'Approve: the ordinary service carries it out as the approver',
    description:
      "A refund request is created as the approver's (it then waits for its own second approver, as every staff refund does); a promo code is created switched off; a recipe is saved to its site as the approver's change, unless the recipe changed since (then the proposal ends as `failed`). Needs the kind's own permission besides `ai:approve` (403), and someone other than the person who asked (403 `own-approval`). If the ordinary service refuses it, the proposal ends as `failed` and nothing changed. 409 `approval-decided` once it was decided or lapsed.",
    tags: TAGS,
    params: agentApprovalParamsSchema,
    responses: { 200: agentApprovalSchema },
    errors: [403, 404, 409],
    // It can create a refund request: a repeated tap replays the first answer.
    idempotent: true,
    audit: ['agent.approval_approved'],
  })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('approvalId') id: string,
    @Req() request: Request,
  ): Promise<Approval> {
    return this.approvals.approve(id, decider(auth, request));
  }

  @Post(':approvalId/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ai:approve')
  @Contract({
    operationId: 'adminRejectAgentApproval',
    summary: 'Reject: nothing is done',
    description:
      "Needs the kind's own permission besides `ai:approve`, and someone other than the person who asked, as approving does.",
    tags: TAGS,
    params: agentApprovalParamsSchema,
    body: rejectAgentApprovalSchema,
    responses: { 200: agentApprovalSchema },
    errors: [403, 404, 409],
    audit: ['agent.approval_rejected'],
  })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('approvalId') id: string,
    @Body() body: z.infer<typeof rejectAgentApprovalSchema>,
    @Req() request: Request,
  ): Promise<Approval> {
    return this.approvals.reject(id, body.reason, decider(auth, request));
  }
}
