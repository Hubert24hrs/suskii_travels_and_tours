import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
  adminLiveRidesSchema,
  createdSchema,
  fareRuleBodySchema,
  fareRuleListSchema,
  idParamsSchema,
  incidentListSchema,
  incidentQuerySchema,
  placeBodySchema,
  placeUpdateSchema,
  resolveIncidentSchema,
  rideIdParamsSchema,
  staffCancelSchema,
} from './rides.schemas';
import { RidesAdminService } from './rides-admin.service';
import { SafetyService } from './safety.service';

const TAGS = ['Admin'];

/**
 * Ride operations (`ground:manage`) and the safety desk (`safety:manage`), ADR-049 and ADR-050:
 * fare rules, curated places, the live board, stopping a ride, and the incident queue.
 */
@CarsFeatureRoute('rides')
@Controller('admin/rides')
export class AdminRidesController {
  constructor(
    private readonly admin: RidesAdminService,
    private readonly safety: SafetyService,
  ) {}

  @Get('fare-rules')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListRideFareRules',
    summary: 'Ride fare rules',
    tags: TAGS,
    responses: { 200: fareRuleListSchema },
    errors: [403],
  })
  fareRules(): Promise<z.infer<typeof fareRuleListSchema>> {
    return this.admin.fareRules();
  }

  @Put('fare-rules')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminSaveRideFareRule',
    summary: 'Create or replace the fare rule for a city and category',
    description: 'Booked rides keep the terms they were quoted with.',
    tags: TAGS,
    body: fareRuleBodySchema,
    responses: { 200: createdSchema },
    audit: ['ride.fare_rule_saved'],
    errors: [403, 422],
  })
  saveFareRule(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof fareRuleBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof createdSchema>> {
    return this.admin.saveFareRule(body, staffActor(auth, request));
  }

  @Post('places')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCreateRidePlace',
    summary: 'Add a place rides can start or end at',
    tags: TAGS,
    body: placeBodySchema,
    responses: { 201: createdSchema },
    audit: ['ride.place_created'],
    errors: [403, 422],
  })
  createPlace(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof placeBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof createdSchema>> {
    return this.admin.createPlace(body, staffActor(auth, request));
  }

  @Patch('places/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUpdateRidePlace',
    summary: 'Change or deactivate a place',
    tags: TAGS,
    params: idParamsSchema,
    body: placeUpdateSchema,
    responses: { 204: null },
    audit: ['ride.place_updated'],
    errors: [403, 404, 422],
  })
  async updatePlace(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof placeUpdateSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.updatePlace(id, body, staffActor(auth, request));
  }

  @Get('live')
  @AdminRoute('safety:manage')
  @Contract({
    operationId: 'adminListLiveRides',
    summary: 'Rides not yet finished, with exact driver positions',
    tags: TAGS,
    responses: { 200: adminLiveRidesSchema },
    errors: [403],
  })
  live(): Promise<z.infer<typeof adminLiveRidesSchema>> {
    return this.admin.liveRides();
  }

  @Post(':rideId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('safety:manage')
  @Contract({
    operationId: 'adminCancelRide',
    summary: 'Stop a ride and refund it in full',
    tags: TAGS,
    params: rideIdParamsSchema,
    body: staffCancelSchema,
    responses: { 204: null },
    audit: ['ride.staff_cancelled'],
    errors: [403, 404, 409],
  })
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('rideId') rideId: string,
    @Body() body: z.output<typeof staffCancelSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.cancel(rideId, body, staffActor(auth, request));
  }

  @Get('incidents')
  @AdminRoute('safety:manage')
  @Contract({
    operationId: 'adminListSafetyIncidents',
    summary: 'SOS alerts, PIN lockouts and route deviations',
    tags: TAGS,
    query: incidentQuerySchema,
    responses: { 200: incidentListSchema },
    errors: [403],
  })
  incidents(
    @Query() query: z.output<typeof incidentQuerySchema>,
  ): Promise<z.infer<typeof incidentListSchema>> {
    return this.safety.incidents(query.status);
  }

  @Post('incidents/:id/acknowledge')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('safety:manage')
  @Contract({
    operationId: 'adminAcknowledgeIncident',
    summary: 'Take an incident',
    tags: TAGS,
    params: idParamsSchema,
    responses: { 204: null },
    audit: ['safety.incident_acknowledged'],
    errors: [403, 404],
  })
  async acknowledge(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.safety.acknowledge(id, staffActor(auth, request));
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('safety:manage')
  @Contract({
    operationId: 'adminResolveIncident',
    summary: 'Close an incident with its outcome',
    tags: TAGS,
    params: idParamsSchema,
    body: resolveIncidentSchema,
    responses: { 204: null },
    audit: ['safety.incident_resolved'],
    errors: [403, 404],
  })
  async resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof resolveIncidentSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.safety.resolve(id, body, staffActor(auth, request));
  }
}
