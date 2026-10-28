import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { MetasearchAdminService } from './metasearch-admin.service';
import {
  adminMetasearchPartnerKeySchema,
  adminMetasearchPartnerSchema,
  adminMetasearchReportSchema,
  metasearchPartnerIdParamsSchema,
  metasearchPartnerInputSchema,
  metasearchPartnerPatchSchema,
  type AdminMetasearchPartner,
  type AdminMetasearchPartnerKey,
  type AdminMetasearchReport,
  type MetasearchPartnerInput,
  type MetasearchPartnerPatch,
} from './metasearch.schemas';

const TAGS = ['Admin'];

/** Metasearch partners, their keys and their 30-day report (ADR-081). */
@Controller('admin/metasearch/partners')
export class AdminMetasearchController {
  constructor(private readonly partners: MetasearchAdminService) {}

  @Get()
  @AdminRoute('reports:read')
  @Contract({
    operationId: 'adminGetMetasearchReport',
    summary: 'Metasearch partners with 30 days of landings, price accuracy and bookings',
    description:
      'Price accuracy: same or lower among landings that found the flight. Link success: landings that found the flight among all. Booking values are per currency and never converted.',
    tags: TAGS,
    responses: { 200: adminMetasearchReportSchema },
    errors: [403],
  })
  report(): Promise<AdminMetasearchReport> {
    return this.partners.report();
  }

  @Post()
  @AdminRoute('pricing:manage')
  @StepUp()
  @Contract({
    operationId: 'adminCreateMetasearchPartner',
    summary: 'Add a metasearch partner and issue its key',
    description: 'The key is in this answer only; the API keeps an HMAC of it.',
    tags: TAGS,
    body: metasearchPartnerInputSchema,
    responses: { 201: adminMetasearchPartnerKeySchema },
    errors: [403, 409],
    audit: ['metasearch_partner.created'],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: MetasearchPartnerInput,
    @Req() request: Request,
  ): Promise<AdminMetasearchPartnerKey> {
    return this.partners.create(body, staffActor(auth, request));
  }

  @Patch(':partnerId')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminUpdateMetasearchPartner',
    summary: "Change a partner's name or limits, or switch its access off or on",
    tags: TAGS,
    params: metasearchPartnerIdParamsSchema,
    body: metasearchPartnerPatchSchema,
    responses: { 200: adminMetasearchPartnerSchema },
    errors: [403, 404],
    audit: ['metasearch_partner.updated'],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('partnerId') partnerId: string,
    @Body() body: MetasearchPartnerPatch,
    @Req() request: Request,
  ): Promise<AdminMetasearchPartner> {
    return this.partners.update(partnerId, body, staffActor(auth, request));
  }

  @Post(':partnerId/key')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('pricing:manage')
  @StepUp()
  @Contract({
    operationId: 'adminRotateMetasearchKey',
    summary: "Replace a partner's key",
    description: 'The old key stops working at once. The new key is in this answer only.',
    tags: TAGS,
    params: metasearchPartnerIdParamsSchema,
    responses: { 200: adminMetasearchPartnerKeySchema },
    errors: [403, 404],
    audit: ['metasearch_partner.key_rotated'],
  })
  rotate(
    @CurrentAuth() auth: AuthContext,
    @Param('partnerId') partnerId: string,
    @Req() request: Request,
  ): Promise<AdminMetasearchPartnerKey> {
    return this.partners.rotateKey(partnerId, staffActor(auth, request));
  }
}
