import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { PrivacyBreachesService } from './privacy-breaches.service';
import {
  adminPrivacyBreachCreateSchema,
  adminPrivacyBreachNoticeSchema,
  adminPrivacyRequestCloseSchema,
  adminPrivacyRequestCreateSchema,
  privacyBreachDetailSchema,
  privacyBreachPageSchema,
  privacyBreachQuerySchema,
  privacyRecordParamsSchema,
  privacyRequestPageSchema,
  privacyRequestQuerySchema,
  privacyRequestSchema,
} from './privacy-register.schemas';
import { PrivacyRequestsService } from './privacy-requests.service';

const TAGS = ['Admin'];
type RequestView = z.infer<typeof privacyRequestSchema>;
type BreachDetail = z.infer<typeof privacyBreachDetailSchema>;

/** The data rights request and breach registers (ADR-089), for the privacy officer. */
@Controller('admin/privacy')
export class AdminPrivacyController {
  constructor(
    private readonly requests: PrivacyRequestsService,
    private readonly breaches: PrivacyBreachesService,
  ) {}

  @Get('requests')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminListPrivacyRequests',
    summary: 'Data rights requests (open ones by due time)',
    tags: TAGS,
    query: privacyRequestQuerySchema,
    responses: { 200: privacyRequestPageSchema },
    errors: [403],
  })
  listRequests(
    @Query() query: z.infer<typeof privacyRequestQuerySchema>,
  ): Promise<z.infer<typeof privacyRequestPageSchema>> {
    return this.requests.list(query);
  }

  @Post('requests')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminOpenPrivacyRequest',
    audit: ['privacy.request_opened'],
    summary: 'Record a data rights request received by email, phone, post or support',
    description:
      'The due time follows the jurisdiction (`PRIVACY_RULES`). The person is an account or an email address, which is stored encrypted and shown masked.',
    tags: TAGS,
    body: adminPrivacyRequestCreateSchema,
    responses: { 201: privacyRequestSchema },
    errors: [403, 404],
  })
  openRequest(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof adminPrivacyRequestCreateSchema>,
    @Req() request: Request,
  ): Promise<RequestView> {
    return this.requests.open(body, staffActor(auth, request));
  }

  @Post('requests/:id/close')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminClosePrivacyRequest',
    audit: ['privacy.request_closed'],
    summary: 'Close a request as completed, or refused with a reason',
    description: 'A closed request cannot be closed again (409 `request-closed`).',
    tags: TAGS,
    params: privacyRecordParamsSchema,
    body: adminPrivacyRequestCloseSchema,
    responses: { 201: privacyRequestSchema },
    errors: [403, 404, 409],
  })
  closeRequest(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof adminPrivacyRequestCloseSchema>,
    @Req() request: Request,
  ): Promise<RequestView> {
    return this.requests.close(id, body, staffActor(auth, request));
  }

  @Get('breaches')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminListPrivacyBreaches',
    summary: 'Personal data breaches with their regulator notices (newest first)',
    tags: TAGS,
    query: privacyBreachQuerySchema,
    responses: { 200: privacyBreachPageSchema },
    errors: [403],
  })
  listBreaches(
    @Query() query: z.infer<typeof privacyBreachQuerySchema>,
  ): Promise<z.infer<typeof privacyBreachPageSchema>> {
    return this.breaches.list(query);
  }

  @Get('breaches/:id')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminGetPrivacyBreach',
    summary: 'One breach with its details',
    tags: TAGS,
    params: privacyRecordParamsSchema,
    responses: { 200: privacyBreachDetailSchema },
    errors: [403, 404],
  })
  getBreach(@Param('id') id: string): Promise<BreachDetail> {
    return this.breaches.get(id);
  }

  @Post('breaches')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminOpenPrivacyBreach',
    audit: ['privacy.breach_opened'],
    summary: 'Open a personal data breach',
    description:
      'Creates one notice per jurisdiction, due `breachNoticeDueAt` after awareness (72 hours). Details are stored encrypted.',
    tags: TAGS,
    body: adminPrivacyBreachCreateSchema,
    responses: { 201: privacyBreachDetailSchema },
    errors: [403],
  })
  openBreach(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof adminPrivacyBreachCreateSchema>,
    @Req() request: Request,
  ): Promise<BreachDetail> {
    return this.breaches.open(body, staffActor(auth, request));
  }

  @Post('breaches/:id/notices')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminRecordPrivacyBreachNotice',
    audit: ['privacy.breach_notice_recorded'],
    summary: "Record a regulator's notice, or that none is required",
    description:
      'For a jurisdiction the breach was opened for (404 otherwise); a closed breach takes no changes (409 `breach-closed`).',
    tags: TAGS,
    params: privacyRecordParamsSchema,
    body: adminPrivacyBreachNoticeSchema,
    responses: { 201: privacyBreachDetailSchema },
    errors: [403, 404, 409],
  })
  recordNotice(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof adminPrivacyBreachNoticeSchema>,
    @Req() request: Request,
  ): Promise<BreachDetail> {
    return this.breaches.recordNotice(id, body, staffActor(auth, request));
  }

  @Post('breaches/:id/close')
  @AdminRoute('privacy:manage')
  @Contract({
    operationId: 'adminClosePrivacyBreach',
    audit: ['privacy.breach_closed'],
    summary: 'Close a breach',
    description:
      'Refused while a regulator notice is pending (409 `notices-pending`) or when already closed (409 `breach-closed`).',
    tags: TAGS,
    params: privacyRecordParamsSchema,
    responses: { 201: privacyBreachDetailSchema },
    errors: [403, 404, 409],
  })
  closeBreach(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<BreachDetail> {
    return this.breaches.close(id, staffActor(auth, request));
  }
}
