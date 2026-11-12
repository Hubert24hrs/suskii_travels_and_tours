import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { z } from 'zod';

import { MAX_PRICE_ALERTS, type PriceAlertInput } from '@suskii/shared';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import {
  alertIdParamsSchema,
  createPriceAlertSchema,
  priceAlertListSchema,
  priceAlertRunSchema,
  priceAlertSchema,
} from './alerts.schemas';
import { PriceAlertsService } from './price-alerts.service';

const TAGS = ['Account'];

/** The signed-in traveller's price alerts (ADR-032). */
@Controller('me/price-alerts')
export class PriceAlertsController {
  constructor(private readonly alerts: PriceAlertsService) {}

  @Get()
  @Contract({
    operationId: 'listPriceAlerts',
    summary: 'My price alerts, active first',
    tags: TAGS,
    responses: { 200: priceAlertListSchema },
  })
  async list(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof priceAlertListSchema>> {
    return { alerts: await this.alerts.list(auth.userId), limit: MAX_PRICE_ALERTS };
  }

  @Post()
  @Contract({
    operationId: 'createPriceAlert',
    summary: 'Watch a flight route for a date or a month',
    description: `One adult. Up to ${MAX_PRICE_ALERTS} active alerts (409 \`price-alert-limit\`); the same route twice is 409 \`price-alert-exists\`. Notices follow the price-alert channel choices.`,
    tags: TAGS,
    body: createPriceAlertSchema,
    responses: { 201: priceAlertSchema },
    errors: [409, 422],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: PriceAlertInput,
  ): Promise<z.infer<typeof priceAlertSchema>> {
    return this.alerts.create(auth.userId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Contract({
    operationId: 'deletePriceAlert',
    summary: 'Stop a price alert',
    tags: TAGS,
    params: alertIdParamsSchema,
    responses: { 204: null },
    errors: [404],
  })
  async remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.alerts.remove(auth.userId, id);
  }
}

/** Worker-only: checks due alerts (ADR-032). */
@InternalRoute()
@Controller('internal/price-alerts')
export class InternalPriceAlertsController {
  constructor(private readonly alerts: PriceAlertsService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'runPriceAlerts',
    summary: 'Check due price alerts and notify drops',
    tags: ['Internal'],
    responses: { 200: priceAlertRunSchema },
    errors: [401, 404],
  })
  run(): Promise<z.infer<typeof priceAlertRunSchema>> {
    return this.alerts.run();
  }
}
