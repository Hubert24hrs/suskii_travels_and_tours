import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, Public } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';

import {
  adminPrimePlanListSchema,
  adminPrimePlanSchema,
  createPrimePlanSchema,
  myPrimeSchema,
  planIdParamsSchema,
  primePlanListSchema,
  primePlansQuerySchema,
  updatePrimePlanSchema,
  type CreatePrimePlan,
  type UpdatePrimePlan,
} from './prime.schemas';
import { PrimeService } from './prime.service';

/** Suskii Prime plans and the caller's membership (ADR-030). */
@Controller()
export class PrimeController {
  constructor(private readonly prime: PrimeService) {}

  @Get('prime/plans')
  @Public()
  @Contract({
    operationId: 'listPrimePlans',
    summary: 'Suskii Prime plans on sale',
    description:
      'Empty until staff publish a plan (clients then show "coming soon"). Buy one with `createInhouseQuote` (`kind: "membership"`) and `createBooking`.',
    tags: ['Prime'],
    query: primePlansQuerySchema,
    responses: { 200: primePlanListSchema },
  })
  async plans(
    @Query() query: z.output<typeof primePlansQuerySchema>,
  ): Promise<z.infer<typeof primePlanListSchema>> {
    return { plans: await this.prime.published(query.currency) };
  }

  @Get('me/prime')
  @Contract({
    operationId: 'getMyPrime',
    summary: 'My Suskii Prime membership',
    description:
      'Refresh the session after a purchase is confirmed so searches price you as a member.',
    tags: ['Prime'],
    responses: { 200: myPrimeSchema },
  })
  mine(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof myPrimeSchema>> {
    return this.prime.mine(auth.userId);
  }
}

/** Plan management for staff (`pricing:manage`); the console UI arrives in phase 10. */
@Controller('admin/prime')
export class AdminPrimeController {
  constructor(private readonly prime: PrimeService) {}

  @Get('plans')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminListPrimePlans',
    summary: 'Every Suskii Prime plan with its active members',
    tags: ['Admin'],
    responses: { 200: adminPrimePlanListSchema },
    errors: [403],
  })
  async list(): Promise<z.infer<typeof adminPrimePlanListSchema>> {
    return { plans: await this.prime.adminList() };
  }

  @Post('plans')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminCreatePrimePlan',
    audit: ['prime.plan_created'],
    summary: 'Create a Suskii Prime plan (as a draft)',
    tags: ['Admin'],
    body: createPrimePlanSchema,
    responses: { 201: adminPrimePlanSchema },
    errors: [403, 409],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreatePrimePlan,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminPrimePlanSchema>> {
    return this.prime.create(body, { userId: auth.userId, context: requestContext(request) });
  }

  @Patch('plans/:id')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminUpdatePrimePlan',
    audit: ['prime.plan_updated'],
    summary: 'Change a plan: prices, benefits, copy or status',
    description:
      'Running terms keep the benefits they were bought with; new purchases and the price re-check before payment use the plan as it is now.',
    tags: ['Admin'],
    params: planIdParamsSchema,
    body: updatePrimePlanSchema,
    responses: { 200: adminPrimePlanSchema },
    errors: [403, 404],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: UpdatePrimePlan,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminPrimePlanSchema>> {
    return this.prime.update(id, body, { userId: auth.userId, context: requestContext(request) });
  }
}
