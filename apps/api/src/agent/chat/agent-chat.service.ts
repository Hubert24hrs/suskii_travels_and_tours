import { Readable } from 'node:stream';

import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  AGENT_CONVERSATION_MESSAGE_LIMIT,
  CUSTOMER_AGENTS,
  DEFAULT_SEARCH_TIME_ZONE,
  agentScopesFor,
  localDate,
  staffAgentsFor,
  type AgentAudience,
  type AgentChannel,
  type AgentName,
  type AgentRunEnd,
  type AgentRunRequest,
  type Role,
} from '@suskii/shared';

import type { BudgetReservation } from '../../ai-search/ai-search-budget';
import { scrubQuery } from '../../ai-search/scrub';
import { BackgroundTasks } from '../../common/background-tasks';
import { ProblemDetailsException } from '../../common/problem-details';
import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { HmacService } from '../../crypto/hmac.service';
import type { AgentConversation, AgentRunStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { REDIS } from '../../infra/redis';
import { agentCost, agentRunDuration, agentRuns } from '../../telemetry/metrics';
import { AgentBudget } from '../agent-budget';
import { AgentFlags } from '../agent-flags';
import { AgentGrants } from '../agent-grants';
import { AgentPause } from '../agent-pause';
import { AgentSettingsService } from '../agent-settings.service';

import type { AgentMessageDto, AgentStreamEvent } from './agent-chat.schemas';
import { AGENT_CLIENT, AgentClient, failedRun } from './agent-client';
import {
  AgentConversationsService,
  type AgentCaller,
  type MessageParts,
} from './agent-conversations.service';
import { runCostMicroUsd } from './agent-pricing';
import { AgentRunLog, type LoggedEvent } from './agent-run-log';

/** How long after its time limit a run may still hold its conversation. */
const LOCK_MARGIN_MS = 30_000;
/** How often a stream looks for new events, and how often it says it is still there. */
const STREAM_POLL_MS = 250;
const STREAM_HEARTBEAT_MS = 15_000;

/** What the model gets when nothing of a message is left after scrubbing (only a number, say). */
const SCRUBBED_AWAY = '(the message held only details that are not passed on)';

const busyKey = (conversationId: string): string => `agent:conv:${conversationId}:busy`;

/** Releases the conversation only while it still holds this run. */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const problem = (status: number, slug: string, title: string, detail?: string) =>
  new ProblemDetailsException(status, slug, title, detail);

const STATUS_OF: Readonly<Partial<Record<AgentRunEnd['outcome'], AgentRunStatus>>> = {
  answered: 'succeeded',
  handover: 'succeeded',
  confirmation: 'waiting',
  cancelled: 'cancelled',
  paused: 'refused',
};

/**
 * One message of a traveller, end to end (ADR-101). The API checks the switch, the pause, the
 * conversation and the spend cap, stores the words (sealed), creates the run and seals a grant
 * for it; the agent service gets a scrubbed copy of the words and that grant, and answers in
 * events. The run goes on in the background whether or not the client is still listening: its
 * events land in a log clients stream or poll, and its answer is stored when it ends.
 *
 * Nothing here reads a model's words as an instruction: the answer is text and cards for the
 * traveller, already checked by the agent's guard and parsed against the wire schema.
 */
@Injectable()
export class AgentChatService {
  private readonly logger = new Logger(AgentChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: AgentConversationsService,
    private readonly flags: AgentFlags,
    private readonly pause: AgentPause,
    private readonly settings: AgentSettingsService,
    private readonly budget: AgentBudget,
    private readonly grants: AgentGrants,
    private readonly log: AgentRunLog,
    private readonly background: BackgroundTasks,
    private readonly hmac: HmacService,
    @Inject(AGENT_CLIENT) private readonly client: AgentClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Throws unless the assistant can answer right now. */
  async available(): Promise<void> {
    this.flags.require();
    if (await this.pause.paused()) {
      throw problem(
        HttpStatus.SERVICE_UNAVAILABLE,
        'agent-paused',
        'The assistant is paused',
        'Use the ordinary screens; the assistant will be back.',
      );
    }
    if (!this.flags.configured()) {
      throw problem(
        HttpStatus.SERVICE_UNAVAILABLE,
        'agent-unavailable',
        'The assistant is unavailable',
      );
    }
  }

  async send(
    conversationId: string,
    text: string,
    caller: AgentCaller,
    roles: readonly Role[],
  ): Promise<{ runId: string; message: AgentMessageDto }> {
    await this.available();
    const conversation = await this.conversations.load(conversationId, caller);
    return this.post(
      conversation,
      text,
      conversation.userId
        ? { userId: conversation.userId }
        : { guestKey: this.hmac.digest('agent-guest', caller.context.ip) },
      roles,
    );
  }

  /**
   * A staff member's message to the staff agents (ADR-107). Which agents answer follows from
   * that person's own permissions: someone whose roles open none of them has nobody to ask.
   */
  async sendForStaff(
    conversationId: string,
    text: string,
    staff: { userId: string; roles: readonly Role[] },
  ): Promise<{ runId: string; message: AgentMessageDto }> {
    await this.available();
    const conversation = await this.conversations.loadForStaff(conversationId, staff.userId);
    const scopes = agentScopesFor({
      userId: staff.userId,
      roles: [...staff.roles],
      channel: 'console',
    });
    if (staffAgentsFor(scopes).length === 0) throw new ForbiddenException();
    return this.post(conversation, text, { userId: staff.userId }, staff.roles);
  }

  /** The events of a staff member's own run. */
  async eventsForStaff(
    runId: string,
    after: number,
    userId: string,
  ): Promise<{ runId: string; status: AgentRunStatus; done: boolean; events: LoggedEvent[] }> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, conversationId: true },
    });
    if (!run?.conversationId) throw new NotFoundException();
    await this.conversations.loadForStaff(run.conversationId, userId);
    const events = await this.log.read(runId, after);
    return { runId, status: run.status, done: run.status !== 'running', events };
  }

  /** Stores the message, starts the run in the background and answers at once. */
  private async post(
    conversation: AgentConversation,
    text: string,
    payer: { userId: string } | { guestKey: string },
    roles: readonly Role[],
  ): Promise<{ runId: string; message: AgentMessageDto }> {
    if (conversation.status !== 'open') {
      throw problem(
        HttpStatus.CONFLICT,
        'agent-conversation-closed',
        'This conversation is closed',
      );
    }
    if (conversation.messageCount >= AGENT_CONVERSATION_MESSAGE_LIMIT) {
      throw problem(
        HttpStatus.CONFLICT,
        'agent-conversation-full',
        'This conversation is full',
        'Start a new conversation to continue.',
      );
    }

    const { runId, reservation } = await this.begin(conversation, payer);

    const messageId = uuidv7();
    const now = new Date();
    let stored;
    try {
      stored = await this.prisma.$transaction(async (tx) => {
        // The traveller wrote instead of tapping: what waited for their tap is over.
        await tx.agentConfirmation.updateMany({
          where: { conversationId: conversation.id, status: 'pending' },
          data: { status: 'expired', decidedAt: now },
        });
        await this.openRun(tx, runId, conversation, 'message');
        const message = await tx.agentMessage.create({
          data: {
            id: messageId,
            conversationId: conversation.id,
            role: 'user',
            kind: 'text',
            bodyEncrypted: this.conversations.seal(messageId, text),
            runId,
          },
        });
        await tx.agentConversation.update({
          where: { id: conversation.id },
          data: { messageCount: { increment: 1 }, lastMessageAt: now },
        });
        return message;
      });
    } catch (error) {
      await this.budget.settle(reservation, 0).catch(() => undefined);
      await this.release(conversation.id, runId);
      throw error;
    }

    // The model never gets what the traveller wrote: only a copy without contact details
    // and document-like numbers (ADR-105).
    const request = this.request(
      runId,
      conversation,
      { kind: 'message', text: scrubQuery(text) || SCRUBBED_AWAY },
      roles,
      now,
      await this.settings.disabledAgents(),
    );
    this.background.run('agent-run', () => this.execute(request, conversation, reservation));
    return { runId, message: this.conversations.message(stored) };
  }

  /**
   * Continues a turn that waited for the traveller's tap (ADR-107): the assistant is told how
   * the confirmation ended and what the records hold, and answers in a run of its own.
   */
  async resume(
    conversation: AgentConversation,
    roles: readonly Role[],
    input: Extract<AgentRunRequest['input'], { kind: 'resume' }>,
  ): Promise<string> {
    await this.available();
    if (!conversation.userId) throw new NotFoundException();
    const { runId, reservation } = await this.begin(conversation, {
      userId: conversation.userId,
    });
    const now = new Date();
    try {
      await this.prisma.$transaction((tx) => this.openRun(tx, runId, conversation, 'resume'));
    } catch (error) {
      await this.budget.settle(reservation, 0).catch(() => undefined);
      await this.release(conversation.id, runId);
      throw error;
    }
    const request = this.request(
      runId,
      conversation,
      input,
      roles,
      now,
      await this.settings.disabledAgents(),
    );
    this.background.run('agent-run', () => this.execute(request, conversation, reservation));
    return runId;
  }

  /** Takes the conversation's turn and reserves the run's spend, or says why not. */
  private async begin(
    conversation: AgentConversation,
    payer: { userId: string } | { guestKey: string },
  ): Promise<{ runId: string; reservation: BudgetReservation }> {
    const runId = uuidv7();
    // One run per conversation at a time: two would write the same thread and lose a turn.
    const locked = await this.redis.set(
      busyKey(conversation.id),
      runId,
      'PX',
      this.config.AGENT_RUN_TIMEOUT_MS + LOCK_MARGIN_MS,
      'NX',
    );
    if (locked !== 'OK') {
      throw problem(
        HttpStatus.CONFLICT,
        'agent-busy',
        'The assistant is still answering',
        'Wait for the answer to your last message.',
      );
    }
    try {
      // A run the API lost (a restart) must not keep the conversation looking busy.
      await this.prisma.agentRun.updateMany({
        where: {
          conversationId: conversation.id,
          status: 'running',
          startedAt: {
            lt: new Date(Date.now() - this.config.AGENT_RUN_TIMEOUT_MS - LOCK_MARGIN_MS),
          },
        },
        data: { status: 'failed', outcome: 'timeout', finishedAt: new Date() },
      });
      const reserved = await this.budget.reserve(payer);
      if (typeof reserved === 'string') {
        throw problem(
          HttpStatus.TOO_MANY_REQUESTS,
          'agent-budget',
          "The assistant has reached today's limit",
          'Use the ordinary screens, or try again tomorrow.',
        );
      }
      return { runId, reservation: reserved };
    } catch (error) {
      await this.release(conversation.id, runId);
      throw error;
    }
  }

  /** The run's row; a run that waited for a tap has done its part once the next one starts. */
  private async openRun(
    tx: Prisma.TransactionClient,
    runId: string,
    conversation: AgentConversation,
    trigger: 'message' | 'resume',
  ): Promise<void> {
    await tx.agentRun.updateMany({
      where: { conversationId: conversation.id, status: 'waiting' },
      data: { status: 'succeeded' },
    });
    await tx.agentRun.create({
      data: {
        id: runId,
        conversationId: conversation.id,
        audience: conversation.audience,
        channel: conversation.channel,
        agent: conversation.audience === 'staff' ? 'executive' : 'concierge',
        trigger,
      },
    });
  }

  /** The events of a run after number `after`, for the caller whose conversation it answers. */
  async events(
    runId: string,
    after: number,
    caller: AgentCaller,
  ): Promise<{ runId: string; status: AgentRunStatus; done: boolean; events: LoggedEvent[] }> {
    const run = await this.runOf(runId, caller);
    const events = await this.log.read(runId, after);
    return { runId, status: run.status, done: run.status !== 'running', events };
  }

  /**
   * The same events as a server-sent stream: each with its number as the id, so a dropped
   * connection resumes with `Last-Event-ID`. It ends with the run, or when the run's time is up.
   */
  async stream(runId: string, after: number, caller: AgentCaller): Promise<Readable> {
    await this.runOf(runId, caller);
    const deadline = Date.now() + this.config.AGENT_RUN_TIMEOUT_MS + LOCK_MARGIN_MS;
    const log = this.log;
    const prisma = this.prisma;
    async function* frames(): AsyncGenerator<string> {
      let seen = after;
      let lastWrite = Date.now();
      yield 'retry: 2000\n\n';
      for (;;) {
        const events = await log.read(runId, seen);
        for (const event of events) {
          seen = event.id;
          const { id, ...body } = event;
          yield `id: ${id}\nevent: ${body.type}\ndata: ${JSON.stringify(body)}\n\n`;
          lastWrite = Date.now();
          if (body.type === 'done') return;
        }
        if (events.length === 0) {
          // The log can outlive nobody: a run that ended without one more event ends the stream.
          const run = await prisma.agentRun.findUnique({
            where: { id: runId },
            select: { status: true },
          });
          if (run?.status !== 'running' || Date.now() > deadline) return;
          if (Date.now() - lastWrite > STREAM_HEARTBEAT_MS) {
            yield ': waiting\n\n';
            lastWrite = Date.now();
          }
        }
        await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
      }
    }
    return Readable.from(frames());
  }

  private async runOf(runId: string, caller: AgentCaller) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, conversationId: true },
    });
    // A run whose conversation is gone, or is someone else's, does not exist for this caller.
    if (!run?.conversationId) throw new NotFoundException();
    await this.conversations.load(run.conversationId, caller);
    return run;
  }

  private request(
    runId: string,
    conversation: AgentConversation,
    input: AgentRunRequest['input'],
    roles: readonly Role[],
    now: Date,
    disabled: readonly AgentName[],
  ): AgentRunRequest {
    // A staff conversation lives in the console; a traveller's on the website or in the app.
    const staff = conversation.audience === 'staff';
    const channel: AgentChannel = staff
      ? 'console'
      : conversation.channel === 'app'
        ? 'app'
        : 'web';
    const audience: AgentAudience = staff ? 'staff' : 'customer';
    const signedIn = conversation.userId !== null;
    const scopes = agentScopesFor({ userId: conversation.userId, roles: [...roles], channel });
    return {
      runId,
      threadId: conversation.id,
      grant: this.grants.issue(
        {
          runId,
          conversationId: conversation.id,
          userId: conversation.userId,
          // A guest has no roles, whatever the request carried.
          roles: signedIn ? [...roles] : [],
          audience,
          channel,
          scopes,
          locale: conversation.locale,
          currency: conversation.currency,
          country: conversation.country,
        },
        now.getTime(),
      ),
      context: {
        audience,
        channel,
        locale: conversation.locale,
        currency: conversation.currency,
        country: conversation.country,
        // A staff member reaches the agents their own permissions open, and no others; an
        // agent staff switched off is offered to nobody.
        agents: (staff ? staffAgentsFor(scopes) : [...CUSTOMER_AGENTS]).filter(
          (agent) => !disabled.includes(agent),
        ),
        signedIn,
        today: localDate(now, DEFAULT_SEARCH_TIME_ZONE),
      },
      limits: {
        maxSteps: this.config.AGENT_RUN_MAX_STEPS,
        timeoutMs: this.config.AGENT_RUN_TIMEOUT_MS,
        maxOutputTokens: this.config.AGENT_MAX_OUTPUT_TOKENS,
      },
      input,
    };
  }

  /** Runs the request against the agent service and stores what came of it. */
  private async execute(
    request: AgentRunRequest,
    conversation: AgentConversation,
    reservation: BudgetReservation,
  ): Promise<void> {
    const started = Date.now();
    let end: AgentRunEnd | null = null;
    try {
      await this.client.run(
        request,
        async (event) => {
          if (event.type === 'end') {
            end = event;
            return;
          }
          const status: AgentStreamEvent = {
            type: 'status',
            agent: event.agent,
            phase: event.phase,
            ...(event.tool ? { tool: event.tool } : {}),
          };
          await this.log.append(request.runId, status).catch(() => undefined);
        },
        AbortSignal.timeout(this.config.AGENT_RUN_TIMEOUT_MS + 5000),
      );
    } catch (error) {
      this.logger.warn(
        { runId: request.runId, error: error instanceof Error ? error.name : 'unknown' },
        'agent run could not be carried out',
      );
    }
    try {
      await this.finalize(request, conversation, end ?? failedRun(), reservation, started);
    } catch (error) {
      // The answer could not be stored. The run is closed without one, so the conversation does
      // not look busy until the time limit; its reservation stands, since the model may have
      // been billed. The failure itself is reported by the background runner.
      await this.prisma.agentRun
        .updateMany({
          where: { id: request.runId, status: 'running' },
          data: { status: 'failed', outcome: 'failed', finishedAt: new Date() },
        })
        .catch(() => undefined);
      await this.log
        .append(request.runId, { type: 'done', outcome: 'failed', confirmationId: null })
        .catch(() => undefined);
      throw error;
    } finally {
      await this.release(conversation.id, request.runId);
    }
  }

  private async finalize(
    request: AgentRunRequest,
    conversation: AgentConversation,
    end: AgentRunEnd,
    reservation: BudgetReservation,
    started: number,
  ): Promise<void> {
    const { costMicroUsd, unpriced } = runCostMicroUsd(end.usage, this.config.AGENT_MODEL_PRICES);
    if (unpriced.length > 0) {
      this.logger.warn({ models: unpriced }, 'agent model without a price: charged at the dearest');
    }
    const specialist = end.usage.find((line) => line.role === 'specialist') ?? end.usage[0];
    const status: AgentRunStatus = STATUS_OF[end.outcome] ?? 'failed';
    const now = new Date();

    // What the traveller gets: the checked answer, a notice code, or a confirmation to tap.
    const parts: MessageParts = {
      cards: end.answer?.cards ?? [],
      notice: end.answer ? null : end.notice,
      confirmationId: end.confirmationId,
    };
    const hasMessage = end.answer !== null || end.notice !== null || end.confirmationId !== null;
    const messageId = uuidv7();

    const stored = await this.prisma.$transaction(async (tx) => {
      // The run may have been closed already (a stale-run sweep): the claim keeps one writer.
      const claimed = await tx.agentRun.updateMany({
        where: { id: request.runId, status: 'running' },
        data: {
          status,
          outcome: end.outcome,
          agent: end.agent,
          agents: end.agents,
          modelProvider: specialist?.provider ?? null,
          model: specialist?.model ?? null,
          promptVersion: end.prompts.at(-1) ?? null,
          inputTokens: end.usage.reduce((sum, line) => sum + line.inputTokens, 0),
          outputTokens: end.usage.reduce((sum, line) => sum + line.outputTokens, 0),
          costMicroUsd: BigInt(costMicroUsd),
          steps: end.steps,
          finishedAt: now,
        },
      });
      if (claimed.count === 0 || !hasMessage) return null;
      // The conversation may have been deleted while the run worked: then there is no answer
      // to keep.
      const exists = await tx.agentConversation.findUnique({
        where: { id: conversation.id },
        select: { id: true },
      });
      if (!exists) return null;
      const message = await tx.agentMessage.create({
        data: {
          id: messageId,
          conversationId: conversation.id,
          role: 'assistant',
          agent: end.agent,
          kind: end.answer ? end.answer.kind : end.notice ? 'notice' : 'text',
          bodyEncrypted: this.conversations.seal(messageId, end.answer?.text ?? ''),
          parts,
          sources: end.answer?.sources ?? [],
          runId: request.runId,
        },
      });
      await tx.agentConversation.update({
        where: { id: conversation.id },
        data: { messageCount: { increment: 1 }, lastMessageAt: now },
      });
      return message;
    });

    // A timeout that reported nothing may still have been billed: its reservation stands.
    if (!(end.outcome === 'timeout' && end.usage.length === 0)) {
      await this.budget.settle(reservation, costMicroUsd).catch(() => undefined);
    }
    agentRuns.add(1, { outcome: end.outcome, agent: end.agent, channel: conversation.channel });
    agentRunDuration.record(Date.now() - started, { outcome: end.outcome });
    for (const line of end.usage) {
      const { costMicroUsd: lineCost } = runCostMicroUsd([line], this.config.AGENT_MODEL_PRICES);
      if (lineCost > 0) agentCost.add(lineCost, { model: line.model });
    }

    if (stored) {
      await this.log
        .append(request.runId, { type: 'message', message: this.conversations.message(stored) })
        .catch(() => undefined);
    }
    await this.log
      .append(request.runId, {
        type: 'done',
        outcome: end.outcome,
        confirmationId: end.confirmationId,
      })
      .catch(() => undefined);
  }

  private async release(conversationId: string, runId: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, busyKey(conversationId), runId).catch(() => undefined);
  }
}
