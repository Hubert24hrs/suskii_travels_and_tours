import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  AGENT_CONFIRMATION_MINUTES,
  agentScopesFor,
  type AgentChannel,
  type AgentName,
  type AgentToolDenial,
  type Role,
} from '@suskii/shared';

import { ProblemDetailsException } from '../../common/problem-details';
import type { RequestContext } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import type { AgentConfirmation, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { ErrorReporter } from '../../telemetry/error-reporter';
import type { AgentGrant } from '../agent-grants';
import {
  AgentToolError,
  AgentToolRegistry,
  type AgentConfirmationDraft,
  type AgentTool,
} from '../agent-tool';
import { AgentChatService } from '../chat/agent-chat.service';

import {
  confirmationCardSchema,
  type AgentConfirmationDto,
  type ConfirmationCard,
} from './agent-confirmations.schemas';

const problem = (status: number, slug: string, title: string, detail?: string) =>
  new ProblemDetailsException(status, slug, title, detail);

/** A tap runs the ordinary service with the traveller's own session; it gets this long. */
const TAP_TIMEOUT_MS = 30_000;

const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

/** Who taps: the signed-in owner of the conversation, with the roles of their session. */
export interface ConfirmationCaller {
  userId: string;
  roles: readonly Role[];
  /** The request the tap came in: recorded by the service that carries the action out. */
  context: RequestContext;
}

/**
 * Confirmations (ADR-107): the only way a commit runs. An agent's call to a commit tool
 * becomes a row here, with a card the API built from its own records; the traveller reads it
 * and taps; the tap, made with their own session and an `Idempotency-Key`, runs the tool
 * through the ordinary service; and the assistant is then told what the records hold, nothing
 * more. A model has no way to make that call: it carries a session, not a grant.
 */
@Injectable()
export class AgentConfirmationsService {
  private readonly logger = new Logger(AgentConfirmationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AgentToolRegistry,
    private readonly chat: AgentChatService,
    private readonly errors: ErrorReporter,
  ) {}

  /**
   * Stores what a commit tool asks the traveller to confirm and answers its id. A confirmation
   * still waiting in the conversation is closed first: one question at a time.
   */
  async ask(
    grant: AgentGrant & { userId: string; conversationId: string },
    agent: AgentName,
    tool: AgentTool,
    input: unknown,
    draft: AgentConfirmationDraft,
  ): Promise<string> {
    const card = confirmationCardSchema.parse(draft.card);
    const id = uuidv7();
    const now = new Date();
    // What the card promises may end sooner than a confirmation does (a refund quote).
    const waits = now.getTime() + AGENT_CONFIRMATION_MINUTES * 60_000;
    const expiresAt = new Date(Math.min(waits, draft.expiresAt?.getTime() ?? waits));
    await this.prisma.$transaction(async (tx) => {
      await tx.agentConfirmation.updateMany({
        where: { conversationId: grant.conversationId, status: 'pending' },
        data: { status: 'expired', decidedAt: now },
      });
      await tx.agentConfirmation.create({
        data: {
          id,
          conversationId: grant.conversationId,
          runId: grant.runId,
          userId: grant.userId,
          agent,
          tool: tool.name,
          arguments: asJson(input),
          card: asJson(card),
          ...(draft.expected ? { expected: asJson(draft.expected) } : {}),
          expiresAt,
        },
      });
    });
    return id;
  }

  /** The confirmation if it is the caller's; 404 otherwise, whatever the reason. */
  async get(confirmationId: string, userId: string): Promise<AgentConfirmationDto> {
    return this.present(await this.load(confirmationId, userId));
  }

  /**
   * The traveller's tap. Confirming runs the tool as that person and tells the assistant what
   * the records hold; declining tells it so. Either way the answer names the run to read.
   */
  async decide(
    confirmationId: string,
    decision: 'confirm' | 'decline',
    caller: ConfirmationCaller,
  ): Promise<{ confirmation: AgentConfirmationDto; runId: string | null }> {
    await this.chat.available();
    const row = await this.load(confirmationId, caller.userId);
    if (row.status !== 'pending') {
      throw problem(
        HttpStatus.CONFLICT,
        'confirmation-decided',
        'This was already answered',
        'Ask the assistant again if you still want it.',
      );
    }
    const now = new Date();
    const claimed = await this.prisma.agentConfirmation.updateMany({
      where: { id: row.id, status: 'pending', expiresAt: { gt: now } },
      data: { status: decision === 'confirm' ? 'confirmed' : 'declined', decidedAt: now },
    });
    if (claimed.count === 0) {
      await this.prisma.agentConfirmation.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'expired', decidedAt: now },
      });
      throw problem(
        HttpStatus.CONFLICT,
        'confirmation-expired',
        'This confirmation has expired',
        'Ask the assistant again if you still want it.',
      );
    }

    const conversation = await this.prisma.agentConversation.findUnique({
      where: { id: row.conversationId },
    });
    if (!conversation) throw new NotFoundException();

    let facts: Record<string, unknown> = {};
    let outcome: 'confirmed' | 'declined' | 'failed' =
      decision === 'confirm' ? 'confirmed' : 'declined';
    if (decision === 'confirm') {
      const ran = await this.run(row, conversation.channel as AgentChannel, conversation, caller);
      if (ran.ok) {
        facts = ran.result;
        await this.prisma.agentConfirmation.update({
          where: { id: row.id },
          data: { result: asJson(ran.result) },
        });
      } else {
        outcome = 'failed';
        facts = { actionStatus: 'failed', reason: ran.reason };
        await this.prisma.agentConfirmation.update({
          where: { id: row.id },
          data: { status: 'failed', reason: ran.reason },
        });
      }
    }

    // The assistant says what happened, from the records only. If it cannot be reached the
    // action stands: the card shows its state and the booking page the rest.
    let runId: string | null = null;
    try {
      runId = await this.chat.resume(conversation, caller.roles, {
        kind: 'resume',
        confirmationId: row.id,
        decision: outcome,
        ...(Object.keys(facts).length > 0 ? { facts } : {}),
      });
    } catch (error) {
      this.logger.warn(
        { confirmationId: row.id, error: error instanceof Error ? error.name : 'unknown' },
        'the assistant could not be told about a confirmation',
      );
    }
    return { confirmation: await this.get(row.id, caller.userId), runId };
  }

  /** Runs the tool as the traveller who tapped, with what the card promised. */
  private async run(
    row: AgentConfirmation,
    channel: AgentChannel,
    conversation: { locale: string; currency: string; country: string | null },
    caller: ConfirmationCaller,
  ): Promise<
    | { ok: true; result: Record<string, unknown> }
    | {
        ok: false;
        reason: Extract<AgentToolDenial, 'not_found' | 'refused' | 'failed' | 'timeout'>;
      }
  > {
    const tool = this.registry.get(row.tool);
    // A tool that is gone, or no longer a commit, cannot be what the card promised.
    if (tool?.tier !== 'commit') return { ok: false, reason: 'refused' };
    const input = tool.input.safeParse(row.arguments);
    if (!input.success) return { ok: false, reason: 'refused' };

    // The traveller's own session, not a grant: who they are comes from the request.
    const grant: AgentGrant = {
      runId: row.runId,
      conversationId: row.conversationId,
      userId: caller.userId,
      roles: [...caller.roles],
      audience: 'customer',
      channel,
      scopes: agentScopesFor({ userId: caller.userId, roles: caller.roles, channel }),
      locale: conversation.locale,
      currency: conversation.currency,
      country: conversation.country ?? caller.context.country ?? null,
      expiresAt: new Date(Date.now() + TAP_TIMEOUT_MS),
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TAP_TIMEOUT_MS);
    try {
      const output = await tool.run(input.data, {
        grant,
        agent: row.agent as AgentName,
        signal: abort.signal,
        expected: (row.expected as Record<string, unknown> | null) ?? null,
        request: caller.context,
      });
      // Only what the tool's schema names is kept, and later shown to a model.
      return { ok: true, result: tool.output.parse(output) as Record<string, unknown> };
    } catch (error) {
      if (error instanceof AgentToolError) return { ok: false, reason: error.code };
      this.logger.warn(
        { tool: row.tool, error: error instanceof Error ? error.name : 'unknown' },
        'a confirmed action failed',
      );
      void this.errors.capture(error, { task: `agent-confirmation:${row.tool}` });
      return { ok: false, reason: abort.signal.aborted ? 'timeout' : 'failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  private async load(confirmationId: string, userId: string): Promise<AgentConfirmation> {
    const row = await this.prisma.agentConfirmation.findUnique({ where: { id: confirmationId } });
    if (row?.userId !== userId) throw new NotFoundException();
    if (row.status === 'pending' && row.expiresAt.getTime() <= Date.now()) {
      // Read past its time: it is over, whether or not anyone had noticed yet.
      const expired = await this.prisma.agentConfirmation.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'expired', decidedAt: new Date() },
      });
      if (expired.count > 0) return { ...row, status: 'expired', decidedAt: new Date() };
    }
    return row;
  }

  private present(row: AgentConfirmation): AgentConfirmationDto {
    const card: ConfirmationCard = confirmationCardSchema
      .catch({ kind: 'link', title: row.tool, lines: [], amounts: [] })
      .parse(row.card);
    return {
      id: row.id,
      conversationId: row.conversationId,
      action: row.tool,
      status: row.status,
      reason: (row.reason as AgentToolDenial | null) ?? null,
      card,
      expiresAt: row.expiresAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }
}
