import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { acceptedSchema, reauthRequirementsSchema, type ReauthProof } from '../auth/auth.schemas';
import { clearSessionCookies } from '../auth/cookies';
import { ReauthService } from '../auth/reauth.service';
import { requestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Contract, fileResponse } from '../contract/contract';
import { AUTH_LIMITS, PRIVACY_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { AccountDeletionService } from './account-deletion.service';
import { DataExportService } from './data-export.service';
import {
  accountDeletedSchema,
  dataExportBodySchema,
  deleteAccountBodySchema,
  deletionCheckSchema,
} from './privacy.schemas';

const TAGS = ['Account'];

/** The account holder's data rights: a copy of their data and erasure (ADR-029). */
@Controller('me')
export class PrivacyController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reauth: ReauthService,
    private readonly exports: DataExportService,
    private readonly deletion: AccountDeletionService,
    private readonly audit: AuditService,
  ) {}

  @Get('reauth')
  @Contract({
    operationId: 'getReauthRequirements',
    summary: 'How to confirm a sensitive request',
    description: 'What `exportMyData` and `deleteMyAccount` expect as proof for this account.',
    tags: TAGS,
    responses: { 200: reauthRequirementsSchema },
  })
  requirements(
    @CurrentAuth() auth: AuthContext,
  ): Promise<z.infer<typeof reauthRequirementsSchema>> {
    return this.reauth.requirements(auth.userId);
  }

  @Post('reauth/code')
  @RateLimit(AUTH_LIMITS.sensitive)
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({
    operationId: 'sendReauthCode',
    summary: 'Text a confirmation code (accounts without a password)',
    tags: TAGS,
    responses: { 202: acceptedSchema },
    errors: [409],
  })
  async sendCode(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof acceptedSchema>> {
    await this.reauth.sendCode(auth.userId);
    return { status: 'accepted' };
  }

  @Post('data-export')
  @RateLimit(AUTH_LIMITS.sensitive, PRIVACY_LIMITS.exportUser)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'exportMyData',
    summary: 'Download a copy of my data',
    description:
      'One JSON document with every section of the account’s data (ADR-029), as an attachment. Needs fresh proof: see `getReauthRequirements`.',
    tags: TAGS,
    body: dataExportBodySchema,
    responses: { 200: fileResponse('application/json') },
    errors: [401, 429],
  })
  async exportData(
    @CurrentAuth() auth: AuthContext,
    @Body() body: ReauthProof,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const context = requestContext(request);
    await this.reauth.verify(auth, body, context);
    const document = await this.exports.build(auth.userId);
    await this.audit.record({
      action: 'account.data_exported',
      actorUserId: auth.userId,
      targetType: 'user',
      targetId: auth.userId,
      context,
    });
    const bytes = Buffer.from(JSON.stringify(document, null, 2), 'utf8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(bytes, {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="suskii-data-export-${document.generatedAt.slice(0, 10)}.json"`,
      length: bytes.byteLength,
    });
  }

  @Get('deletion')
  @Contract({
    operationId: 'checkAccountDeletion',
    summary: 'Whether the account can be deleted now',
    tags: TAGS,
    responses: { 200: deletionCheckSchema },
  })
  async check(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof deletionCheckSchema>> {
    const blockers = await this.deletion.blockers(auth.userId);
    return {
      allowed: blockers.length === 0,
      blockers,
      retentionYears: this.config.FINANCIAL_RECORDS_RETENTION_YEARS,
    };
  }

  @Post('deletion')
  @RateLimit(AUTH_LIMITS.sensitive, PRIVACY_LIMITS.deleteUser)
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'deleteMyAccount',
    summary: 'Delete my account',
    description:
      'Signs out every device and anonymises the account at once. Refused (409 with `blockers`) while a booking, payment, trip, visa application or refund is in progress or the wallet holds money. Bookings, payments and refunds are kept for the retention period without contact details.',
    tags: TAGS,
    body: deleteAccountBodySchema,
    responses: { 200: accountDeletedSchema },
    errors: [401, 409, 429],
  })
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof deleteAccountBodySchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<z.infer<typeof accountDeletedSchema>> {
    const context = requestContext(request);
    await this.reauth.verify(auth, body, context);
    const outcome = await this.deletion.delete(auth.userId, context);
    clearSessionCookies(response, this.config);
    return {
      deletedAt: outcome.deletedAt.toISOString(),
      retainedBookings: outcome.retainedBookings,
      retentionYears: this.config.FINANCIAL_RECORDS_RETENTION_YEARS,
    };
  }
}
