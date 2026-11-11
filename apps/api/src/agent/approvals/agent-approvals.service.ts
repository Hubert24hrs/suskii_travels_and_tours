import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  AGENT_APPROVAL_DAYS,
  AGENT_APPROVAL_OPEN_LIMIT,
  AGENT_APPROVAL_PERMISSIONS,
  hasPermissions,
  type AgentApprovalKind,
  type AgentApprovalRejectReason,
  type AgentName,
  type Role,
} from '@suskii/shared';

import type { StaffActor } from '../../admin/admin-helpers';
import { AdminPromosService } from '../../admin/admin-promos.service';
import { AuditService } from '../../audit/audit.service';
import { RefundsService } from '../../bookings/refunds.service';
import { ProblemDetailsException } from '../../common/problem-details';
import type { AgentApproval, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { PriceSourcesService } from '../../price-intel/price-sources.service';
import { recipesSchema } from '../../price-intel/recipes';
import { ErrorReporter } from '../../telemetry/error-reporter';
import { agentApprovals } from '../../telemetry/metrics';

import {
  promoCodeProposalSchema,
  refundRequestProposalSchema,
  sourceRecipeProposalSchema,
  type AgentApprovalDto,
} from './agent-approvals.schemas';

const DAY_MS = 86_400_000;

const problem = (status: number, slug: string, title: string, detail?: string) =>
  new ProblemDetailsException(status, slug, title, detail);

const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** JSON with its keys in order: a stored payload (jsonb keeps no key order) compares equal. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );

/** Who decides: a staff member, with the roles of their session. */
export interface ApprovalDecider extends StaffActor {
  roles: readonly Role[];
}

/**
 * The approvals queue (ADR-107). A staff agent can only prepare: its proposal is a row here,
 * holding exactly what would be done. A person other than the one who asked reads it and
 * decides; approving runs the ordinary service as that person, with that service's own rules
 * (a refund request still waits for its second approver; a promo code is created switched
 * off). An agent has no route to decide anything here.
 */
@Injectable()
export class AgentApprovalsService {
  private readonly logger = new Logger(AgentApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundsService,
    private readonly promos: AdminPromosService,
    private readonly sources: PriceSourcesService,
    private readonly audit: AuditService,
    private readonly errors: ErrorReporter,
  ) {}

  /**
   * Stores a proposal for the staff member an agent is working for, and answers its id. The
   * same proposal asked twice is one row; a person's conversations hold a few at a time.
   */
  async propose(input: {
    kind: AgentApprovalKind;
    requestedBy: string;
    agent: AgentName;
    runId: string;
    conversationId: string | null;
    subject: { type: string; id: string } | null;
    payload: unknown;
  }): Promise<{ id: string; created: boolean } | { refused: 'limit' }> {
    const payload = asJson(this.payloadOf(input.kind, input.payload));
    const now = new Date();
    const made = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.requestedBy}::uuid FOR UPDATE`;
      const waiting = await tx.agentApproval.findMany({
        where: { requestedBy: input.requestedBy, status: 'pending', expiresAt: { gt: now } },
        select: { id: true, kind: true, payload: true },
      });
      const wanted = canonical(payload);
      const same = waiting.find(
        (row) => row.kind === input.kind && canonical(row.payload) === wanted,
      );
      if (same) return { id: same.id, created: false };
      if (waiting.length >= AGENT_APPROVAL_OPEN_LIMIT) return { refused: 'limit' as const };
      const row = await tx.agentApproval.create({
        data: {
          kind: input.kind,
          requestedBy: input.requestedBy,
          agent: input.agent,
          runId: input.runId,
          conversationId: input.conversationId,
          subjectType: input.subject?.type ?? null,
          subjectId: input.subject?.id ?? null,
          payload,
          expiresAt: new Date(now.getTime() + AGENT_APPROVAL_DAYS * DAY_MS),
        },
      });
      await this.audit.record(
        {
          action: 'agent.approval_proposed',
          actorUserId: input.requestedBy,
          targetType: 'agent_approval',
          targetId: row.id,
          metadata: { kind: input.kind, agent: input.agent, runId: input.runId },
        },
        tx,
      );
      return { id: row.id, created: true };
    });
    if ('created' in made && made.created) {
      agentApprovals.add(1, { kind: input.kind, outcome: 'proposed' });
    }
    return made;
  }

  async list(
    status: AgentApproval['status'],
    limit: number,
    reader: ApprovalDecider,
  ): Promise<AgentApprovalDto[]> {
    await this.expireDue();
    const rows = await this.prisma.agentApproval.findMany({
      where: { status },
      // The queue shows its age: what waited longest comes first.
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      take: limit,
    });
    return rows.map((row) => this.present(row, reader));
  }

  async get(id: string, reader: ApprovalDecider): Promise<AgentApprovalDto> {
    await this.expireDue();
    const row = await this.prisma.agentApproval.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return this.present(row, reader);
  }

  /**
   * A person approves: the proposal is claimed, then carried out by the ordinary service as
   * that person. If that service refuses, the proposal ends as `failed` and nothing changed.
   */
  async approve(id: string, decider: ApprovalDecider): Promise<AgentApprovalDto> {
    const row = await this.claimable(id, decider);
    const kind = row.kind as AgentApprovalKind;
    const now = new Date();
    const claimed = await this.prisma.agentApproval.updateMany({
      where: { id, status: 'pending', expiresAt: { gt: now } },
      data: { status: 'approved', decidedBy: decider.userId, decidedAt: now },
    });
    if (claimed.count === 0) throw this.decided();

    let result: { type: string; id: string };
    try {
      result = await this.carryOut(kind, row.payload, decider);
    } catch (error) {
      const refused = error instanceof HttpException && error.getStatus() < 500;
      if (!refused) {
        this.logger.warn(
          { approvalId: id, error: error instanceof Error ? error.name : 'unknown' },
          'an approved proposal could not be carried out',
        );
        void this.errors.capture(error, { task: `agent-approval:${kind}` });
      }
      await this.prisma.agentApproval.update({
        where: { id },
        data: { status: 'failed', reason: refused ? 'refused' : 'failed' },
      });
      await this.audit.record({
        action: 'agent.approval_approved',
        actorUserId: decider.userId,
        targetType: 'agent_approval',
        targetId: id,
        context: decider.context,
        metadata: { kind, carriedOut: false, reason: refused ? 'refused' : 'failed' },
      });
      agentApprovals.add(1, { kind, outcome: 'failed' });
      return this.get(id, decider);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.agentApproval.update({
        where: { id },
        data: { resultType: result.type, resultId: result.id },
      });
      await this.audit.record(
        {
          action: 'agent.approval_approved',
          actorUserId: decider.userId,
          targetType: 'agent_approval',
          targetId: id,
          context: decider.context,
          metadata: { kind, carriedOut: true, resultType: result.type, resultId: result.id },
        },
        tx,
      );
    });
    agentApprovals.add(1, { kind, outcome: 'approved' });
    return this.get(id, decider);
  }

  async reject(
    id: string,
    reason: AgentApprovalRejectReason,
    decider: ApprovalDecider,
  ): Promise<AgentApprovalDto> {
    const row = await this.claimable(id, decider);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.agentApproval.updateMany({
        where: { id, status: 'pending', expiresAt: { gt: now } },
        data: { status: 'rejected', reason, decidedBy: decider.userId, decidedAt: now },
      });
      if (claimed.count === 0) throw this.decided();
      await this.audit.record(
        {
          action: 'agent.approval_rejected',
          actorUserId: decider.userId,
          targetType: 'agent_approval',
          targetId: id,
          context: decider.context,
          metadata: { reason },
        },
        tx,
      );
    });
    agentApprovals.add(1, { kind: row.kind, outcome: 'rejected' });
    return this.get(id, decider);
  }

  /** Proposals nobody decided in time lapse: the facts they rest on have gone stale. */
  async expireDue(now = new Date()): Promise<number> {
    const { count } = await this.prisma.agentApproval.updateMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired' },
    });
    if (count > 0) agentApprovals.add(count, { kind: 'any', outcome: 'expired' });
    return count;
  }

  /**
   * A pending proposal the decider may decide: never one their own question produced, and
   * only a kind their own permissions cover (`ai:approve` alone decides nothing).
   */
  private async claimable(id: string, decider: ApprovalDecider): Promise<AgentApproval> {
    await this.expireDue();
    const row = await this.prisma.agentApproval.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (row.status !== 'pending') throw this.decided();
    const permission = AGENT_APPROVAL_PERMISSIONS[row.kind as AgentApprovalKind];
    if (!hasPermissions(decider.roles, [permission])) throw new ForbiddenException();
    if (row.requestedBy === decider.userId) {
      throw problem(
        HttpStatus.FORBIDDEN,
        'own-approval',
        'Someone else must decide this',
        'You asked for it, so another person approves or rejects it.',
      );
    }
    return row;
  }

  private decided(): ProblemDetailsException {
    return problem(
      HttpStatus.CONFLICT,
      'approval-decided',
      'This was already decided',
      'It was approved, rejected or ran out of time.',
    );
  }

  /** The proposal as its kind's schema holds it; anything else is not a proposal. */
  private payloadOf(kind: AgentApprovalKind, payload: unknown): unknown {
    if (kind === 'refund_request') return refundRequestProposalSchema.parse(payload);
    if (kind === 'source_recipe') return sourceRecipeProposalSchema.parse(payload);
    // Whatever was drafted, a promo code starts switched off: switching it on is a person's.
    return { ...promoCodeProposalSchema.parse(payload), active: false };
  }

  private async carryOut(
    kind: AgentApprovalKind,
    payload: unknown,
    decider: ApprovalDecider,
  ): Promise<{ type: string; id: string }> {
    const staff: StaffActor = { userId: decider.userId, context: decider.context };
    if (kind === 'refund_request') {
      const proposal = refundRequestProposalSchema.parse(payload);
      // The approver is the requester of the refund: its own approval is someone else's still.
      const refund = await this.refunds.requestByStaff(
        proposal.bookingId,
        {
          paymentId: proposal.paymentId,
          amount: proposal.amount,
          destination: 'original',
          reason: proposal.reason,
          note: null,
          cancelBooking: proposal.cancelBooking,
        },
        staff,
      );
      return { type: 'refund', id: refund.id };
    }
    if (kind === 'source_recipe') {
      const proposal = sourceRecipeProposalSchema.parse(payload);
      const source = await this.sources.get(proposal.sourceId);
      const recipes = recipesSchema.catch({}).parse(source.recipes);
      // Someone changed the recipe since: what was proposed no longer fits what is there.
      if (recipes[proposal.product]?.version !== proposal.replaces) {
        throw problem(
          HttpStatus.CONFLICT,
          'recipe-changed',
          'The recipe changed since this was proposed',
        );
      }
      // The approver's own change to the site, by the ordinary service: audited as theirs,
      // and the drift incident closes as it does when a person saves a recipe.
      await this.sources.update(
        proposal.sourceId,
        { recipes: { ...recipes, [proposal.product]: proposal.recipe } },
        staff,
      );
      return { type: 'price_source', id: proposal.sourceId };
    }
    const proposal = promoCodeProposalSchema.parse(payload);
    const promo = await this.promos.create({ ...proposal, active: false }, staff);
    return { type: 'promo_code', id: promo.id };
  }

  private present(row: AgentApproval, reader: ApprovalDecider): AgentApprovalDto {
    const kind = row.kind as AgentApprovalKind;
    return {
      id: row.id,
      kind,
      status: row.status,
      agent: row.agent as AgentName,
      requestedBy: row.requestedBy,
      mayDecide:
        row.status === 'pending' &&
        row.requestedBy !== reader.userId &&
        hasPermissions(reader.roles, ['ai:approve', AGENT_APPROVAL_PERMISSIONS[kind]]),
      subject:
        row.subjectType && row.subjectId ? { type: row.subjectType, id: row.subjectId } : null,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      reason: row.reason,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      result: row.resultType && row.resultId ? { type: row.resultType, id: row.resultId } : null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
