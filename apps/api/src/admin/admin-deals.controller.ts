import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import {
  adminDealRouteListSchema,
  adminDealRouteSchema,
  adminDestinationListSchema,
  adminDestinationSchema,
  adminIdParamsSchema,
  dealRouteInputSchema,
  dealRoutePatchSchema,
  destinationInputSchema,
  destinationPatchSchema,
} from './admin-deals.schemas';
import { AdminDealsService } from './admin-deals.service';
import { staffActor } from './admin-helpers';

const TAGS = ['Admin'];

@Controller('admin')
export class AdminDealsController {
  constructor(private readonly deals: AdminDealsService) {}

  @Get('deal-routes')
  @AdminRoute('deals:manage')
  @Contract({
    operationId: 'adminListDealRoutes',
    summary: 'Deal routes the worker keeps fresh, with their last refresh',
    tags: TAGS,
    responses: { 200: adminDealRouteListSchema },
    errors: [403],
  })
  listRoutes(): Promise<z.infer<typeof adminDealRouteListSchema>> {
    return this.deals.listRoutes();
  }

  @Post('deal-routes')
  @AdminRoute('deals:manage')
  @Contract({
    operationId: 'adminCreateDealRoute',
    summary: 'Add a deal route',
    description: 'The deals worker finds fares for it on its next refresh.',
    tags: TAGS,
    body: dealRouteInputSchema,
    responses: { 201: adminDealRouteSchema },
    errors: [403, 409, 422],
    audit: ['deals.route_created'],
  })
  createRoute(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof dealRouteInputSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminDealRouteSchema>> {
    return this.deals.createRoute(body, staffActor(auth, request));
  }

  @Patch('deal-routes/:id')
  @AdminRoute('deals:manage')
  @Contract({
    operationId: 'adminUpdateDealRoute',
    summary: 'Change or deactivate a deal route',
    tags: TAGS,
    params: adminIdParamsSchema,
    body: dealRoutePatchSchema,
    responses: { 200: adminDealRouteSchema },
    errors: [403, 404, 409, 422],
    audit: ['deals.route_updated'],
  })
  updateRoute(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof dealRoutePatchSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminDealRouteSchema>> {
    return this.deals.updateRoute(id, body, staffActor(auth, request));
  }

  @Get('destinations')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminListDestinations',
    summary: 'Hotel destination content, published or not',
    tags: TAGS,
    responses: { 200: adminDestinationListSchema },
    errors: [403],
  })
  listDestinations(): Promise<z.infer<typeof adminDestinationListSchema>> {
    return this.deals.listDestinations();
  }

  @Post('destinations')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminCreateDestination',
    summary: 'Add a hotel destination page',
    tags: TAGS,
    body: destinationInputSchema,
    responses: { 201: adminDestinationSchema },
    errors: [403, 409, 422],
    audit: ['destination.created'],
  })
  createDestination(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof destinationInputSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminDestinationSchema>> {
    return this.deals.createDestination(body, staffActor(auth, request));
  }

  @Patch('destinations/:id')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminUpdateDestination',
    summary: 'Change, feature or unpublish a hotel destination',
    tags: TAGS,
    params: adminIdParamsSchema,
    body: destinationPatchSchema,
    responses: { 200: adminDestinationSchema },
    errors: [403, 404, 409],
    audit: ['destination.updated'],
  })
  updateDestination(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof destinationPatchSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminDestinationSchema>> {
    return this.deals.updateDestination(id, body, staffActor(auth, request));
  }
}
