import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import {
  destinationIdParamsSchema,
  pruneResultSchema,
  refreshResultSchema,
  refreshTargetsSchema,
  routeIdParamsSchema,
  type RefreshResult,
} from './deals.schemas';
import { DealsService } from './deals.service';
import { DestinationsService } from './destinations.service';

const TAGS = ['Internal'];

/** Worker-only routes that refresh deals and hotel destination prices (ADR-011). */
@InternalRoute()
@Controller('internal')
export class InternalRefreshController {
  constructor(
    private readonly deals: DealsService,
    private readonly destinations: DestinationsService,
  ) {}

  @Get('refresh-targets')
  @Contract({
    operationId: 'listRefreshTargets',
    summary: 'Deal routes and hotel destinations to refresh',
    tags: TAGS,
    responses: { 200: refreshTargetsSchema },
    errors: [401, 404],
  })
  async targets(): Promise<z.infer<typeof refreshTargetsSchema>> {
    const [dealRoutes, hotelDestinations] = await Promise.all([
      this.deals.activeRoutes(),
      this.destinations.published(),
    ]);
    return { dealRoutes, hotelDestinations };
  }

  @Post('deals/routes/:routeId/refresh')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'refreshDealRoute',
    summary: 'Search a deal route now and store the cheapest fare',
    description: 'Answers 503 when every supplier search failed; the worker retries with backoff.',
    tags: TAGS,
    params: routeIdParamsSchema,
    responses: { 200: refreshResultSchema },
    errors: [401, 404, 503],
  })
  refreshRoute(@Param('routeId') routeId: string): Promise<RefreshResult> {
    return this.deals.refresh(routeId);
  }

  @Post('destinations/:destinationId/refresh')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'refreshHotelDestination',
    summary: 'Search a hotel destination now and store the cheapest rate',
    tags: TAGS,
    params: destinationIdParamsSchema,
    responses: { 200: refreshResultSchema },
    errors: [401, 404, 503],
  })
  refreshDestination(@Param('destinationId') destinationId: string): Promise<RefreshResult> {
    return this.destinations.refresh(destinationId);
  }

  @Post('snapshots/prune')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'pruneSnapshots',
    summary: 'Delete deal and destination snapshots past the retention window',
    tags: TAGS,
    responses: { 200: pruneResultSchema },
    errors: [401, 404],
  })
  async prune(): Promise<z.infer<typeof pruneResultSchema>> {
    const [deletedDeals, deletedDestinations] = await Promise.all([
      this.deals.prune(),
      this.destinations.prune(),
    ]);
    return { deletedDeals, deletedDestinations };
  }
}
