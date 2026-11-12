import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { AdminCompaniesService } from './admin-companies.service';
import {
  adminCompanyDetailSchema,
  adminCompanyPageSchema,
  adminCompanyParamsSchema,
  adminCompanyQuerySchema,
} from './companies.schemas';

type Detail = z.infer<typeof adminCompanyDetailSchema>;
const TAGS = ['Admin'];

@Controller('admin/companies')
export class AdminCompaniesController {
  constructor(private readonly companies: AdminCompaniesService) {}

  @Get()
  @AdminRoute('users:read')
  @Contract({
    operationId: 'adminListCompanies',
    summary: 'Company accounts (newest first)',
    tags: TAGS,
    query: adminCompanyQuerySchema,
    responses: { 200: adminCompanyPageSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof adminCompanyQuerySchema>,
  ): Promise<z.infer<typeof adminCompanyPageSchema>> {
    return this.companies.list(query);
  }

  @Get(':id')
  @AdminRoute('users:read')
  @Contract({
    operationId: 'adminGetCompany',
    summary: 'A company with its members and policy',
    tags: TAGS,
    params: adminCompanyParamsSchema,
    responses: { 200: adminCompanyDetailSchema },
    errors: [403, 404],
  })
  get(@Param('id') id: string): Promise<Detail> {
    return this.companies.get(id);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('users:manage')
  @StepUp()
  @Contract({
    operationId: 'adminSuspendCompany',
    audit: ['company.suspended'],
    summary: 'Suspend a company',
    description:
      'Members can no longer book for the company (409 `company-suspended`); their own accounts and bookings are untouched.',
    tags: TAGS,
    params: adminCompanyParamsSchema,
    responses: { 200: adminCompanyDetailSchema },
    errors: [403, 404, 409],
  })
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<Detail> {
    return this.companies.setStatus(id, 'suspended', staffActor(auth, request));
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('users:manage')
  @Contract({
    operationId: 'adminReinstateCompany',
    audit: ['company.reinstated'],
    summary: 'Reinstate a suspended company',
    tags: TAGS,
    params: adminCompanyParamsSchema,
    responses: { 200: adminCompanyDetailSchema },
    errors: [403, 404, 409],
  })
  reinstate(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<Detail> {
    return this.companies.setStatus(id, 'active', staffActor(auth, request));
  }
}
