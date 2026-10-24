import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';

import {
  adminLayoutListSchema,
  adminOperatorListSchema,
  adminRouteListSchema,
  adminTerminalListSchema,
  adminTripListSchema,
  adminTripQuerySchema,
  agentParamsSchema,
  cancelTripSchema,
  createLayoutSchema,
  createOperatorSchema,
  createRouteSchema,
  createTerminalSchema,
  createTripSchema,
  groundCreatedSchema,
  idParamsSchema,
  scheduleTripsSchema,
  tripCancelledSchema,
  tripsScheduledSchema,
  updateLayoutSchema,
  updateOperatorSchema,
  updateRouteSchema,
  updateTerminalSchema,
  updateTripSchema,
} from './buses.schemas';
import { GroundAdminService } from './ground-admin.service';

const TAGS = ['Admin'];

/**
 * Bus inventory for operations (`ground:manage`, ADR-049): operators and their boarding agents,
 * terminals, routes, coach layouts and departures. Manual inventory is the decision-gate default;
 * an operator API can feed the same tables later.
 */
@CarsFeatureRoute('buses')
@Controller('admin')
export class AdminGroundController {
  constructor(private readonly ground: GroundAdminService) {}

  @Get('ground/operators')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListBusOperators',
    summary: 'Bus operators',
    tags: TAGS,
    responses: { 200: adminOperatorListSchema },
    errors: [403],
  })
  listBusOperators(): Promise<z.infer<typeof adminOperatorListSchema>> {
    return this.ground.operators();
  }

  @Post('ground/operators')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCreateBusOperator',
    audit: ['ground.operator_created'],
    summary: 'Create a bus operator (draft)',
    tags: TAGS,
    body: createOperatorSchema,
    responses: { 201: groundCreatedSchema },
    errors: [403, 409],
  })
  createBusOperator(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createOperatorSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof groundCreatedSchema>> {
    return this.ground.createOperator(body, staffActor(auth, request));
  }

  @Patch('ground/operators/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUpdateBusOperator',
    audit: ['ground.operator_updated'],
    summary: 'Update, publish or archive a bus operator',
    tags: TAGS,
    params: idParamsSchema,
    body: updateOperatorSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async updateBusOperator(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateOperatorSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.ground.updateOperator(id, body, staffActor(auth, request));
  }

  @Put('ground/operators/:id/agents/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminAddOperatorAgent',
    audit: ['ground.agent_added'],
    summary: "Make an account one of the operator's boarding agents",
    tags: TAGS,
    params: agentParamsSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async addOperatorAgent(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.ground.addAgent(id, userId, staffActor(auth, request));
  }

  @Delete('ground/operators/:id/agents/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminRemoveOperatorAgent',
    audit: ['ground.agent_removed'],
    summary: 'Remove a boarding agent',
    tags: TAGS,
    params: agentParamsSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async removeOperatorAgent(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.ground.removeAgent(id, userId, staffActor(auth, request));
  }

  @Get('ground/terminals')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListBusTerminals',
    summary: 'Bus terminals',
    tags: TAGS,
    responses: { 200: adminTerminalListSchema },
    errors: [403],
  })
  listBusTerminals(): Promise<z.infer<typeof adminTerminalListSchema>> {
    return this.ground.terminals();
  }

  @Post('ground/terminals')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCreateBusTerminal',
    audit: ['ground.terminal_created'],
    summary: 'Create a bus terminal',
    tags: TAGS,
    body: createTerminalSchema,
    responses: { 201: groundCreatedSchema },
    errors: [403, 409, 422],
  })
  createBusTerminal(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createTerminalSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof groundCreatedSchema>> {
    return this.ground.createTerminal(body, staffActor(auth, request));
  }

  @Patch('ground/terminals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUpdateBusTerminal',
    audit: ['ground.terminal_updated'],
    summary: 'Update or deactivate a bus terminal',
    tags: TAGS,
    params: idParamsSchema,
    body: updateTerminalSchema,
    responses: { 204: null },
    errors: [403, 404, 422],
  })
  async updateBusTerminal(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateTerminalSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.ground.updateTerminal(id, body, staffActor(auth, request));
  }

  @Get('ground/routes')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListBusRoutes',
    summary: 'Bus routes',
    tags: TAGS,
    responses: { 200: adminRouteListSchema },
    errors: [403],
  })
  listBusRoutes(): Promise<z.infer<typeof adminRouteListSchema>> {
    return this.ground.routes();
  }

  @Post('ground/routes')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCreateBusRoute',
    audit: ['ground.route_created'],
    summary: 'Add a route to an operator',
    tags: TAGS,
    body: createRouteSchema,
    responses: { 201: groundCreatedSchema },
    errors: [403, 404, 409, 422],
  })
  createBusRoute(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createRouteSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof groundCreatedSchema>> {
    return this.ground.createRoute(body, staffActor(auth, request));
  }

  @Patch('ground/routes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUpdateBusRoute',
    audit: ['ground.route_updated'],
    summary: 'Update or deactivate a bus route',
    tags: TAGS,
    params: idParamsSchema,
    body: updateRouteSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async updateBusRoute(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateRouteSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.ground.updateRoute(id, body, staffActor(auth, request));
  }

  @Get('ground/layouts')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListBusLayouts',
    summary: 'Coach seat maps',
    tags: TAGS,
    responses: { 200: adminLayoutListSchema },
    errors: [403],
  })
  listBusLayouts(): Promise<z.infer<typeof adminLayoutListSchema>> {
    return this.ground.layouts();
  }

  @Post('ground/layouts')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCreateBusLayout',
    audit: ['ground.layout_created'],
    summary: 'Add a coach seat map to an operator',
    tags: TAGS,
    body: createLayoutSchema,
    responses: { 201: groundCreatedSchema },
    errors: [403, 404],
  })
  createBusLayout(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createLayoutSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof groundCreatedSchema>> {
    return this.ground.createLayout(body, staffActor(auth, request));
  }

  @Patch('ground/layouts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUpdateBusLayout',
    audit: ['ground.layout_updated'],
    summary: 'Update a coach seat map',
    tags: TAGS,
    params: idParamsSchema,
    body: updateLayoutSchema,
    responses: { 204: null },
    errors: [403, 404, 409],
  })
  async updateBusLayout(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateLayoutSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.ground.updateLayout(id, body, staffActor(auth, request));
  }

  @Get('ground/trips')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListBusTrips',
    summary: 'Bus departures in a date range',
    tags: TAGS,
    query: adminTripQuerySchema,
    responses: { 200: adminTripListSchema },
    errors: [403],
  })
  listBusTrips(
    @Query() query: z.output<typeof adminTripQuerySchema>,
  ): Promise<z.infer<typeof adminTripListSchema>> {
    return this.ground.trips(query);
  }

  @Post('ground/trips')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCreateBusTrip',
    audit: ['ground.trip_created'],
    summary: 'Add a departure',
    tags: TAGS,
    body: createTripSchema,
    responses: { 201: groundCreatedSchema },
    errors: [403, 404, 422],
  })
  createBusTrip(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createTripSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof groundCreatedSchema>> {
    return this.ground.createTrip(body, staffActor(auth, request));
  }

  @Post('ground/trips/schedule')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminScheduleBusTrips',
    audit: ['ground.trips_scheduled'],
    summary: 'Add departures for a date range and daily times',
    tags: TAGS,
    body: scheduleTripsSchema,
    responses: { 201: tripsScheduledSchema },
    errors: [403, 404, 422],
  })
  scheduleBusTrips(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof scheduleTripsSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof tripsScheduledSchema>> {
    return this.ground.scheduleTrips(body, staffActor(auth, request));
  }

  @Patch('ground/trips/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUpdateBusTrip',
    audit: ['ground.trip_updated'],
    summary: 'Change the fare, blocked seats or status of a departure',
    tags: TAGS,
    params: idParamsSchema,
    body: updateTripSchema,
    responses: { 204: null },
    errors: [403, 404, 409, 422],
  })
  async updateBusTrip(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateTripSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.ground.updateTrip(id, body, staffActor(auth, request));
  }

  @Post('ground/trips/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCancelBusTrip',
    audit: ['ground.trip_cancelled'],
    summary: 'Cancel a departure, refunding its paid bookings',
    tags: TAGS,
    params: idParamsSchema,
    body: cancelTripSchema,
    responses: { 200: tripCancelledSchema },
    errors: [403, 404],
  })
  cancelBusTrip(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof cancelTripSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof tripCancelledSchema>> {
    return this.ground.cancelTrip(id, body, staffActor(auth, request));
  }
}
