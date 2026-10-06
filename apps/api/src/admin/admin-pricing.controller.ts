import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { staffActor } from './admin-helpers';
import {
  adminFeeRuleListSchema,
  adminFeeRuleSchema,
  adminMarkupRuleListSchema,
  adminMarkupRuleSchema,
  feeRuleInputSchema,
  feeRulePatchSchema,
  markupRuleInputSchema,
  markupRulePatchSchema,
  ruleIdParamsSchema,
  ruleListQuerySchema,
} from './admin-pricing.schemas';
import { AdminPricingService } from './admin-pricing.service';

const TAGS = ['Admin'];
const CACHE_NOTE = 'Applies to the next search or quote; quotes already given keep their price.';

@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly pricing: AdminPricingService) {}

  @Get('markups')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminListMarkupRules',
    summary: 'Markup rules by vertical and priority',
    tags: TAGS,
    query: ruleListQuerySchema,
    responses: { 200: adminMarkupRuleListSchema },
    errors: [403],
  })
  listMarkups(
    @Query() query: z.infer<typeof ruleListQuerySchema>,
  ): Promise<z.infer<typeof adminMarkupRuleListSchema>> {
    return this.pricing.listMarkups(query.vertical);
  }

  @Post('markups')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminCreateMarkupRule',
    summary: 'Add a markup rule',
    description: `The first active matching rule (lowest priority) applies. ${CACHE_NOTE}`,
    tags: TAGS,
    body: markupRuleInputSchema,
    responses: { 201: adminMarkupRuleSchema },
    errors: [403],
    audit: ['pricing.markup_created'],
  })
  createMarkup(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof markupRuleInputSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminMarkupRuleSchema>> {
    return this.pricing.createMarkup(body, staffActor(auth, request));
  }

  @Patch('markups/:id')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminUpdateMarkupRule',
    summary: 'Change or deactivate a markup rule',
    description: `The merged rule is validated like a new one. ${CACHE_NOTE}`,
    tags: TAGS,
    params: ruleIdParamsSchema,
    body: markupRulePatchSchema,
    responses: { 200: adminMarkupRuleSchema },
    errors: [403, 404],
    audit: ['pricing.markup_updated'],
  })
  updateMarkup(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof markupRulePatchSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminMarkupRuleSchema>> {
    return this.pricing.updateMarkup(id, body, staffActor(auth, request));
  }

  @Get('fees')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminListFeeRules',
    summary: 'Fee rules by vertical',
    tags: TAGS,
    query: ruleListQuerySchema,
    responses: { 200: adminFeeRuleListSchema },
    errors: [403],
  })
  listFees(
    @Query() query: z.infer<typeof ruleListQuerySchema>,
  ): Promise<z.infer<typeof adminFeeRuleListSchema>> {
    return this.pricing.listFees(query.vertical);
  }

  @Post('fees')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminCreateFeeRule',
    summary: 'Add a customer-visible fee',
    description: `Every active matching fee applies. ${CACHE_NOTE}`,
    tags: TAGS,
    body: feeRuleInputSchema,
    responses: { 201: adminFeeRuleSchema },
    errors: [403],
    audit: ['pricing.fee_created'],
  })
  createFee(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof feeRuleInputSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminFeeRuleSchema>> {
    return this.pricing.createFee(body, staffActor(auth, request));
  }

  @Patch('fees/:id')
  @AdminRoute('pricing:manage')
  @Contract({
    operationId: 'adminUpdateFeeRule',
    summary: 'Change or deactivate a fee',
    description: `The merged rule is validated like a new one. ${CACHE_NOTE}`,
    tags: TAGS,
    params: ruleIdParamsSchema,
    body: feeRulePatchSchema,
    responses: { 200: adminFeeRuleSchema },
    errors: [403, 404],
    audit: ['pricing.fee_updated'],
  })
  updateFee(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof feeRulePatchSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminFeeRuleSchema>> {
    return this.pricing.updateFee(id, body, staffActor(auth, request));
  }
}
