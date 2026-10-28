import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';

import { ATTESTATION_HEADER } from '../attestation/attestation.schemas';
import { ATTESTATION_HEADER_NAME } from '../attestation/attestation.service';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { BOOKING_TOKEN_HEADER } from '../bookings/bookings.schemas';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { RateLimit, SUPPORT_LIMITS } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';

import {
  SUPPORT_TOKEN_HEADER,
  startSupportSchema,
  startedSupportSchema,
  supportConversationListSchema,
  supportConversationQuerySchema,
  supportConversationSchema,
  supportParamsSchema,
  supportReplyRequestSchema,
} from './support.schemas';
import { SupportService, type SupportCaller } from './support.service';

const TAGS = ['Support'];
type Conversation = z.infer<typeof supportConversationSchema>;

function header(request: AuthenticatedRequest, name: string, max = 512): string | null {
  const raw = request.headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  return value.length > 0 && value.length <= max ? value : null;
}

const supportCaller = (request: AuthenticatedRequest): SupportCaller => ({
  client: clientContext(request),
  context: requestContext(request),
  token: header(request, 'x-support-token', 256),
  bookingToken: header(request, 'x-booking-token', 128),
  attestation: header(request, ATTESTATION_HEADER_NAME, 16_384),
});

/**
 * Support conversations for travellers, guests and visitors (ADR-083). Account holders use their
 * session; guests the token returned when they started, or the link from a reply email.
 */
@Public()
@Controller('support/conversations')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @RateLimit(SUPPORT_LIMITS.startIp)
  @Contract({
    operationId: 'startSupportConversation',
    summary: 'Start a support conversation',
    description:
      "Optionally about one of the caller's bookings (guests add `X-Booking-Token`). Without a session, the website sends a Turnstile token and the app a device attestation (400 `bot-check-failed` otherwise), and an email is needed unless the booking gives one; guests receive an access token once. 409 `support-limit` when an account already has 5 open conversations.",
    tags: TAGS,
    headers: [BOOKING_TOKEN_HEADER, ATTESTATION_HEADER],
    body: startSupportSchema,
    responses: { 201: startedSupportSchema },
    errors: [400, 404, 409, 422],
  })
  start(
    @Body() body: z.infer<typeof startSupportSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof startedSupportSchema>> {
    return this.support.start(body, supportCaller(request));
  }

  @Get()
  @RateLimit(SUPPORT_LIMITS.readIp)
  @Contract({
    operationId: 'listSupportConversations',
    summary: "The signed-in traveller's support conversations",
    description: 'Most recently active first; empty without a session (guests open theirs by id).',
    tags: TAGS,
    responses: { 200: supportConversationListSchema },
    errors: [],
  })
  list(
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof supportConversationListSchema>> {
    return this.support.list(supportCaller(request));
  }

  @Get(':conversationId')
  @RateLimit(SUPPORT_LIMITS.readIp)
  @Contract({
    operationId: 'getSupportConversation',
    summary: 'A support conversation and its messages',
    description:
      'Pass `after` with the last message id to poll for new messages. Internal staff notes are never included.',
    tags: TAGS,
    params: supportParamsSchema,
    query: supportConversationQuerySchema,
    headers: [SUPPORT_TOKEN_HEADER],
    responses: { 200: supportConversationSchema },
    errors: [404],
  })
  get(
    @Param('conversationId') conversationId: string,
    @Query() query: z.infer<typeof supportConversationQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<Conversation> {
    return this.support.get(conversationId, supportCaller(request), query.after);
  }

  @Put(':conversationId/read')
  @RateLimit(SUPPORT_LIMITS.readIp)
  @Contract({
    operationId: 'markSupportConversationRead',
    summary: 'Mark every reply so far as read',
    tags: TAGS,
    params: supportParamsSchema,
    headers: [SUPPORT_TOKEN_HEADER],
    responses: { 200: supportConversationSchema },
    errors: [404],
  })
  read(
    @Param('conversationId') conversationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Conversation> {
    return this.support.markRead(conversationId, supportCaller(request));
  }

  @Post(':conversationId/messages')
  @RateLimit(SUPPORT_LIMITS.messageIp)
  @Contract({
    operationId: 'replySupportConversation',
    summary: 'Write to a support conversation',
    description:
      'Reopens a resolved conversation. 409 `support-conversation-full` after 500 messages (start a new one).',
    tags: TAGS,
    params: supportParamsSchema,
    headers: [SUPPORT_TOKEN_HEADER],
    body: supportReplyRequestSchema,
    responses: { 201: supportConversationSchema },
    errors: [404, 409],
  })
  reply(
    @Param('conversationId') conversationId: string,
    @Body() body: z.infer<typeof supportReplyRequestSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<Conversation> {
    return this.support.reply(conversationId, body.message, supportCaller(request));
  }

  @Post(':conversationId/resolve')
  @HttpCode(HttpStatus.OK)
  @RateLimit(SUPPORT_LIMITS.messageIp)
  @Contract({
    operationId: 'resolveSupportConversation',
    summary: 'Mark a support conversation as solved',
    description: 'Writing to it again reopens it.',
    tags: TAGS,
    params: supportParamsSchema,
    headers: [SUPPORT_TOKEN_HEADER],
    responses: { 200: supportConversationSchema },
    errors: [404],
  })
  resolve(
    @Param('conversationId') conversationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<Conversation> {
    return this.support.resolve(conversationId, supportCaller(request));
  }
}
