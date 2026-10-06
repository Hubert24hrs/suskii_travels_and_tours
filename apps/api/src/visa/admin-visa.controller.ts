import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { INHOUSE_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { VisaDocumentsService } from './visa-documents.service';
import {
  applicationIdParamsSchema,
  documentIdParamsSchema,
  documentLinkSchema,
  officerApplicationListSchema,
  officerApplicationQuerySchema,
  officerApplicationSchema,
  officerCommentRequestSchema,
  officerTransitionRequestSchema,
  rejectDocumentRequestSchema,
  ruleIdParamsSchema,
  upsertVisaRuleSchema,
  visaRuleListSchema,
  visaRuleQuerySchema,
  visaRuleSchema,
} from './visa.schemas';
import { VisaService, type StaffActor } from './visa.service';

const TAGS = ['Admin'];

const staff = (auth: AuthContext, request: Request): StaffActor => ({
  userId: auth.userId,
  context: requestContext(request),
});

/**
 * The visa officers' workflow (ADR-026, `visa:process` on admin routes: staff role, MFA session,
 * allowlisted IP). Documents are only ever viewed through audited, expiring links.
 */
@Controller('admin')
export class AdminVisaController {
  constructor(
    private readonly visa: VisaService,
    private readonly documents: VisaDocumentsService,
  ) {}

  @Get('visa-applications')
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminListVisaApplications',
    summary: 'Visa applications, oldest submission first',
    tags: TAGS,
    query: officerApplicationQuerySchema,
    responses: { 200: officerApplicationListSchema },
    errors: [403],
  })
  async list(
    @Query() query: z.output<typeof officerApplicationQuerySchema>,
  ): Promise<z.infer<typeof officerApplicationListSchema>> {
    return { applications: await this.visa.officerList(query) };
  }

  @Get('visa-applications/:applicationId')
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminGetVisaApplication',
    summary: 'A visa application with documents, events and internal notes',
    tags: TAGS,
    params: applicationIdParamsSchema,
    responses: { 200: officerApplicationSchema },
    errors: [403, 404],
  })
  get(
    @Param('applicationId') applicationId: string,
  ): Promise<z.infer<typeof officerApplicationSchema>> {
    return this.visa.officerDetail(applicationId);
  }

  @Post('visa-applications/:applicationId/transitions')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminTransitionVisaApplication',
    audit: ['visa.application_status_changed'],
    summary: 'Move an application on (review, action required, lodged, decision)',
    description:
      'Only the moves in `allowedTransitions` (409 otherwise). `message` is shown to and emailed to the traveller; `note` stays internal.',
    tags: TAGS,
    params: applicationIdParamsSchema,
    body: officerTransitionRequestSchema,
    responses: { 200: officerApplicationSchema },
    errors: [403, 404, 409],
  })
  transition(
    @CurrentAuth() auth: AuthContext,
    @Param('applicationId') applicationId: string,
    @Body() body: z.output<typeof officerTransitionRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof officerApplicationSchema>> {
    return this.visa.transition(applicationId, body, staff(auth, request));
  }

  @Post('visa-applications/:applicationId/comments')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminCommentVisaApplication',
    audit: ['visa.application_message', 'visa.application_note'],
    summary: 'Write to the traveller or add an internal note',
    tags: TAGS,
    params: applicationIdParamsSchema,
    body: officerCommentRequestSchema,
    responses: { 200: officerApplicationSchema },
    errors: [403, 404],
  })
  comment(
    @CurrentAuth() auth: AuthContext,
    @Param('applicationId') applicationId: string,
    @Body() body: z.output<typeof officerCommentRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof officerApplicationSchema>> {
    return this.visa.comment(applicationId, body, staff(auth, request));
  }

  @Post('visa-documents/:documentId/link')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('visa:process')
  @RateLimit(INHOUSE_LIMITS.visaLinkIp)
  @Contract({
    operationId: 'adminCreateVisaDocumentLink',
    audit: ['visa.document_link_issued'],
    summary: 'A short-lived, audited link to view a document',
    tags: TAGS,
    params: documentIdParamsSchema,
    responses: { 200: documentLinkSchema },
    errors: [403, 404],
  })
  link(
    @CurrentAuth() auth: AuthContext,
    @Param('documentId') documentId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof documentLinkSchema>> {
    return this.documents.officerLink(documentId, staff(auth, request));
  }

  @Post('visa-documents/:documentId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminRejectVisaDocument',
    audit: ['visa.document_rejected'],
    summary: 'Reject a document with a message to the traveller',
    description: 'Move the application to `action_required` so they can upload a new one.',
    tags: TAGS,
    params: documentIdParamsSchema,
    body: rejectDocumentRequestSchema,
    responses: { 204: null },
    errors: [403, 404, 409],
  })
  async reject(
    @CurrentAuth() auth: AuthContext,
    @Param('documentId') documentId: string,
    @Body() body: z.infer<typeof rejectDocumentRequestSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.documents.reject(documentId, body.message, staff(auth, request));
  }

  @Get('visa-rules')
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminListVisaRules',
    summary: 'Eligibility rules',
    tags: TAGS,
    query: visaRuleQuerySchema,
    responses: { 200: visaRuleListSchema },
    errors: [403],
  })
  async rules(
    @Query() query: z.output<typeof visaRuleQuerySchema>,
  ): Promise<z.infer<typeof visaRuleListSchema>> {
    return { rules: await this.visa.rules(query) };
  }

  @Put('visa-rules')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminUpsertVisaRule',
    audit: ['visa.rule_upserted'],
    summary: 'Create or replace the rule for a nationality, destination and purpose',
    tags: TAGS,
    body: upsertVisaRuleSchema,
    responses: { 200: visaRuleSchema },
    errors: [403],
  })
  upsertRule(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof upsertVisaRuleSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof visaRuleSchema>> {
    return this.visa.upsertRule(body, staff(auth, request));
  }

  @Delete('visa-rules/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('visa:process')
  @Contract({
    operationId: 'adminDeleteVisaRule',
    audit: ['visa.rule_deleted'],
    summary: 'Delete a rule (the checker then answers `unknown`)',
    tags: TAGS,
    params: ruleIdParamsSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async deleteRule(
    @CurrentAuth() auth: AuthContext,
    @Param('ruleId') ruleId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.visa.deleteRule(ruleId, staff(auth, request));
  }
}
