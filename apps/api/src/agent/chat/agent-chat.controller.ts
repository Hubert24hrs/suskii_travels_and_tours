import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { z } from 'zod';

import { ATTESTATION_HEADER } from '../../attestation/attestation.schemas';
import { ATTESTATION_HEADER_NAME } from '../../attestation/attestation.service';
import type { AuthenticatedRequest } from '../../auth/auth-context';
import { Public } from '../../auth/decorators';
import { BOOKING_TOKEN_HEADER } from '../../bookings/bookings.schemas';
import { requestContext } from '../../common/request-context';
import { Contract, fileResponse } from '../../contract/contract';
import { AGENT_LIMITS, RateLimit } from '../../rate-limit/rate-limit.decorator';
import { clientContext } from '../../search/client-context';
import { AgentFlags } from '../agent-flags';

import {
  AGENT_TOKEN_HEADER,
  agentChatRequestSchema,
  agentChatStartedSchema,
  agentConversationListSchema,
  agentConversationParamsSchema,
  agentConversationSchema,
  agentFeedbackSchema,
  agentRatingSchema,
  agentMessageParamsSchema,
  agentMessageSchema,
  agentRunParamsSchema,
  agentRunQuerySchema,
  agentRunSchema,
  startAgentConversationSchema,
  startedAgentConversationSchema,
} from './agent-chat.schemas';
import { AgentChatService } from './agent-chat.service';
import { AgentConversationsService, type AgentCaller } from './agent-conversations.service';

const TAGS = ['Assistant'];

function header(request: AuthenticatedRequest, name: string, max = 512): string | null {
  const raw = request.headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  return value.length > 0 && value.length <= max ? value : null;
}

const agentCaller = (request: AuthenticatedRequest): AgentCaller => ({
  client: clientContext(request),
  context: requestContext(request),
  token: header(request, 'x-agent-token', 256),
  bookingToken: header(request, 'x-booking-token', 128),
  attestation: header(request, ATTESTATION_HEADER_NAME, 16_384),
});

/**
 * The assistant for travellers (ADR-101): conversations, a message that starts a run, and the
 * run's events as a poll or a stream. Account holders use their session; guests the token
 * returned when their conversation started. Every route answers 404 while the assistant is
 * switched off, and nothing in search, booking or payment depends on any of them.
 */
@Public()
@Controller('agent')
export class AgentChatController {
  constructor(
    private readonly conversations: AgentConversationsService,
    private readonly chat: AgentChatService,
    private readonly flags: AgentFlags,
  ) {}

  @Post('conversations')
  @RateLimit(AGENT_LIMITS.startIp)
  @Contract({
    operationId: 'startAgentConversation',
    summary: 'Start a conversation with the assistant',
    description:
      "Optionally opened from one of the caller's bookings (guests add `X-Booking-Token`). Without a session, the website sends a Turnstile token and the app a device attestation (400 `bot-check-failed` otherwise); guests receive an access token once. 409 `agent-conversation-limit` when an account already has 20 open conversations.",
    tags: TAGS,
    headers: [BOOKING_TOKEN_HEADER, ATTESTATION_HEADER],
    body: startAgentConversationSchema,
    responses: { 201: startedAgentConversationSchema },
    errors: [400, 404, 409],
  })
  async start(
    @Body() body: z.infer<typeof startAgentConversationSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof startedAgentConversationSchema>> {
    await this.chat.available();
    return this.conversations.start(body, agentCaller(request));
  }

  @Get('conversations')
  @RateLimit(AGENT_LIMITS.readIp)
  @Contract({
    operationId: 'listAgentConversations',
    summary: "The signed-in traveller's conversations with the assistant",
    description: 'Most recently active first; empty without a session (guests open theirs by id).',
    tags: TAGS,
    responses: { 200: agentConversationListSchema },
    errors: [404],
  })
  async list(
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof agentConversationListSchema>> {
    this.flags.require();
    const rows = await this.conversations.list(agentCaller(request));
    return {
      conversations: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        messageCount: row.messageCount,
        lastMessageAt: row.lastMessageAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Get('conversations/:conversationId')
  @RateLimit(AGENT_LIMITS.readIp)
  // What was said is the traveller's own: nothing may keep a copy.
  @Header('Cache-Control', 'no-store')
  @Contract({
    operationId: 'getAgentConversation',
    summary: 'A conversation with its messages',
    description:
      "The caller's own conversation; 404 for anyone else's. `activeRunId` names a run that is still answering.",
    tags: TAGS,
    headers: [AGENT_TOKEN_HEADER],
    params: agentConversationParamsSchema,
    responses: { 200: agentConversationSchema },
    errors: [404],
  })
  get(
    @Param() params: z.infer<typeof agentConversationParamsSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof agentConversationSchema>> {
    this.flags.require();
    return this.conversations.get(params.conversationId, agentCaller(request));
  }

  @Delete('conversations/:conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(AGENT_LIMITS.messageIp)
  @Contract({
    operationId: 'deleteAgentConversation',
    summary: 'Delete a conversation',
    description:
      "Deletes the conversation, its messages and the assistant's working state of it. It cannot be undone.",
    tags: TAGS,
    headers: [AGENT_TOKEN_HEADER],
    params: agentConversationParamsSchema,
    responses: { 204: null },
    errors: [404],
  })
  async remove(
    @Param() params: z.infer<typeof agentConversationParamsSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    this.flags.require();
    await this.conversations.delete(params.conversationId, agentCaller(request));
  }

  @Post('chat')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(AGENT_LIMITS.messageIp)
  @Contract({
    operationId: 'sendAgentMessage',
    summary: 'Send a message to the assistant',
    description:
      "Stores the message and starts a run; the answer arrives as events of the run (`GET /v1/agent/runs/{runId}` or its stream). 409 `agent-busy` while the last message is still being answered, 409 `agent-conversation-full` after 200 messages, 429 `agent-budget` when the day's spend cap is reached, 503 `agent-paused` or `agent-unavailable` when the assistant cannot answer. The assistant never books, pays or refunds: an action it proposes is a confirmation the traveller taps.",
    tags: TAGS,
    headers: [AGENT_TOKEN_HEADER],
    body: agentChatRequestSchema,
    responses: { 202: agentChatStartedSchema },
    errors: [400, 404, 409, 429, 503],
  })
  send(
    @Body() body: z.infer<typeof agentChatRequestSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof agentChatStartedSchema>> {
    return this.chat.send(
      body.conversationId,
      body.text,
      agentCaller(request),
      request.auth?.roles ?? [],
    );
  }

  @Get('runs/:runId')
  @RateLimit(AGENT_LIMITS.readIp)
  @Header('Cache-Control', 'no-store')
  @Contract({
    operationId: 'getAgentRun',
    summary: 'The events of a run, for clients that poll',
    description:
      'Status lines while the assistant works, then the answer as a `message` and a `done`. Ask again with `after` set to the last event number seen until `done` is true. Events are kept for an hour; the answer itself stays in the conversation.',
    tags: TAGS,
    headers: [AGENT_TOKEN_HEADER],
    params: agentRunParamsSchema,
    query: agentRunQuerySchema,
    responses: { 200: agentRunSchema },
    errors: [404],
  })
  run(
    @Param() params: z.infer<typeof agentRunParamsSchema>,
    @Query() query: z.infer<typeof agentRunQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof agentRunSchema>> {
    this.flags.require();
    return this.chat.events(params.runId, query.after, agentCaller(request));
  }

  @Get('runs/:runId/stream')
  @RateLimit(AGENT_LIMITS.readIp)
  @Header('Cache-Control', 'no-store')
  // Proxies must pass each event on as it is written.
  @Header('X-Accel-Buffering', 'no')
  @Contract({
    operationId: 'streamAgentRun',
    summary: 'The events of a run as a server-sent event stream',
    description:
      'The same events as the poll, each with its number as the event id: reconnect with `Last-Event-ID` (or `after`) to resume. The stream ends with the run. It is never compressed or cached.',
    tags: TAGS,
    headers: [AGENT_TOKEN_HEADER],
    params: agentRunParamsSchema,
    query: agentRunQuerySchema,
    responses: { 200: fileResponse('text/event-stream') },
    errors: [404],
  })
  async stream(
    @Param() params: z.infer<typeof agentRunParamsSchema>,
    @Query() query: z.infer<typeof agentRunQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    this.flags.require();
    const last = Number(header(request, 'last-event-id', 8));
    const after = Number.isSafeInteger(last) && last > 0 ? Math.min(last, 1000) : query.after;
    const events = await this.chat.stream(params.runId, after, agentCaller(request));
    return new StreamableFile(events, { type: 'text/event-stream; charset=utf-8' });
  }

  @Put('conversations/:conversationId/rating')
  @RateLimit(AGENT_LIMITS.messageIp)
  @Contract({
    operationId: 'rateAgentConversation',
    summary: 'Say how well the assistant helped in a conversation',
    description:
      "A score from 1 to 5 on the caller's own conversation, once the assistant answered in it (409 `agent-conversation-unanswered` before). Rating again replaces the score.",
    tags: TAGS,
    headers: [AGENT_TOKEN_HEADER],
    params: agentConversationParamsSchema,
    body: agentRatingSchema,
    responses: { 200: agentConversationSchema },
    errors: [400, 404, 409],
  })
  rate(
    @Param() params: z.infer<typeof agentConversationParamsSchema>,
    @Body() body: z.infer<typeof agentRatingSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof agentConversationSchema>> {
    this.flags.require();
    return this.conversations.rate(params.conversationId, body.score, agentCaller(request));
  }

  @Put('messages/:messageId/feedback')
  @RateLimit(AGENT_LIMITS.messageIp)
  @Contract({
    operationId: 'rateAgentMessage',
    summary: 'Say whether an answer helped',
    description:
      "A thumb up or down on an answer of the caller's own conversation; null takes it back.",
    tags: TAGS,
    headers: [AGENT_TOKEN_HEADER],
    params: agentMessageParamsSchema,
    body: agentFeedbackSchema,
    responses: { 200: agentMessageSchema },
    errors: [400, 404],
  })
  feedback(
    @Param() params: z.infer<typeof agentMessageParamsSchema>,
    @Body() body: z.infer<typeof agentFeedbackSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof agentMessageSchema>> {
    this.flags.require();
    return this.conversations.feedback(params.messageId, body.feedback, agentCaller(request));
  }
}
