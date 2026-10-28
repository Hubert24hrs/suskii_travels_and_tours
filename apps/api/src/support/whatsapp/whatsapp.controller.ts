import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { Public } from '../../auth/decorators';
import { ProblemDetailsException } from '../../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { Contract, fileResponse } from '../../contract/contract';
import { safeEqual } from '../../crypto/random';
import { SkipRateLimit } from '../../rate-limit/rate-limit.decorator';
import { supportWhatsAppRejected } from '../../telemetry/metrics';
import { whatsappHandshakeQuerySchema, whatsappReceiptSchema } from '../support.schemas';

import { WhatsAppInbox } from './whatsapp-inbox.service';
import { parseWhatsAppDelivery, whatsappSignatureValid } from './whatsapp-webhook';

const TAGS = ['Support'];

/**
 * WhatsApp Cloud API webhook (ADR-084): Meta's handshake, then signed deliveries of messages and
 * statuses. Answers 404 while WhatsApp support is off.
 */
@Public()
@Controller('webhooks/whatsapp')
export class WhatsAppController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly inbox: WhatsAppInbox,
  ) {}

  @Get()
  @SkipRateLimit()
  @Contract({
    operationId: 'verifyWhatsAppWebhook',
    summary: 'WhatsApp webhook handshake',
    description:
      'Meta checks the webhook URL with the verify token; the challenge comes back as plain text when the token matches. Called by Meta only.',
    tags: TAGS,
    query: whatsappHandshakeQuerySchema,
    responses: { 200: fileResponse('text/plain') },
    errors: [403, 404],
  })
  handshake(@Query() query: z.infer<typeof whatsappHandshakeQuerySchema>): StreamableFile {
    const expected = this.enabled().WHATSAPP_VERIFY_TOKEN ?? '';
    if (!safeEqual(query['hub.verify_token'], expected)) {
      supportWhatsAppRejected.add(1, { reason: 'verify-token' });
      throw new ProblemDetailsException(
        HttpStatus.FORBIDDEN,
        'whatsapp-verify-token',
        'The verify token does not match',
      );
    }
    const body = Buffer.from(query['hub.challenge'], 'utf8');
    return new StreamableFile(body, { type: 'text/plain; charset=utf-8', length: body.byteLength });
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  // Meta retries in bursts from shared addresses; the signature is the control here.
  @SkipRateLimit()
  @Contract({
    operationId: 'receiveWhatsAppWebhook',
    summary: 'WhatsApp webhook',
    description:
      'Messages and delivery statuses from the WhatsApp Cloud API, signed with X-Hub-Signature-256 over the raw body. Repeated deliveries are acknowledged without effect. Called by Meta only.',
    tags: TAGS,
    responses: { 200: whatsappReceiptSchema },
    errors: [401, 404],
  })
  async receive(
    @Req() request: RawBodyRequest<Request>,
  ): Promise<z.infer<typeof whatsappReceiptSchema>> {
    const secret = this.enabled().WHATSAPP_APP_SECRET ?? '';
    const header = request.headers['x-hub-signature-256'];
    if (
      !whatsappSignatureValid(
        request.rawBody,
        typeof header === 'string' ? header : undefined,
        secret,
      )
    ) {
      supportWhatsAppRejected.add(1, { reason: 'signature' });
      throw new ProblemDetailsException(
        HttpStatus.UNAUTHORIZED,
        'whatsapp-signature',
        'The webhook signature is not valid',
      );
    }
    // Read exactly the bytes that were signed.
    let json: unknown = null;
    try {
      json = JSON.parse(request.rawBody?.toString('utf8') ?? 'null');
    } catch {
      json = null;
    }
    await this.inbox.receive(parseWhatsAppDelivery(json));
    return { received: true };
  }

  private enabled(): AppConfig {
    if (this.config.WHATSAPP_SUPPORT_PROVIDER === 'none') {
      supportWhatsAppRejected.add(1, { reason: 'disabled' });
      throw new NotFoundException();
    }
    return this.config;
  }
}
