import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { staffActor } from './admin-helpers';
import {
  adminPromoPageSchema,
  adminPromoSchema,
  promoIdParamsSchema,
  promoInputSchema,
  promoListQuerySchema,
  promoPatchSchema,
} from './admin-promos.schemas';
import { AdminPromosService } from './admin-promos.service';

const TAGS = ['Admin'];

@Controller('admin/promos')
export class AdminPromosController {
  constructor(private readonly promos: AdminPromosService) {}

  @Get()
  @AdminRoute('deals:manage')
  @Contract({
    operationId: 'adminListPromoCodes',
    summary: 'Promo codes with their redemption counts (newest first)',
    tags: TAGS,
    query: promoListQuerySchema,
    responses: { 200: adminPromoPageSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof promoListQuerySchema>,
  ): Promise<z.infer<typeof adminPromoPageSchema>> {
    return this.promos.list(query);
  }

  @Post()
  @AdminRoute('deals:manage')
  @Contract({
    operationId: 'adminCreatePromoCode',
    summary: 'Create a promo code',
    tags: TAGS,
    body: promoInputSchema,
    responses: { 201: adminPromoSchema },
    errors: [403, 409],
    audit: ['promo.created'],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof promoInputSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminPromoSchema>> {
    return this.promos.create(body, staffActor(auth, request));
  }

  @Patch(':id')
  @AdminRoute('deals:manage')
  @Contract({
    operationId: 'adminUpdatePromoCode',
    summary: 'Change or deactivate a promo code',
    description:
      'The merged promo is validated like a new one. The code cannot change after its first redemption.',
    tags: TAGS,
    params: promoIdParamsSchema,
    body: promoPatchSchema,
    responses: { 200: adminPromoSchema },
    errors: [403, 404, 409],
    audit: ['promo.updated'],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof promoPatchSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminPromoSchema>> {
    return this.promos.update(id, body, staffActor(auth, request));
  }
}
