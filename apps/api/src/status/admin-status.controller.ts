import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { StatusAdminService } from './status-admin.service';
import {
  adminIncidentCreateSchema,
  adminIncidentPageSchema,
  adminIncidentParamsSchema,
  adminIncidentQuerySchema,
  adminIncidentUpdateSchema,
  statusIncidentSchema,
} from './status.schemas';

const TAGS = ['Admin'];
type Incident = z.infer<typeof statusIncidentSchema>;

/** Incidents on the public status page (ADR-087): staff open, update and resolve them. */
@Controller('admin/status/incidents')
export class AdminStatusController {
  constructor(private readonly incidents: StatusAdminService) {}

  @Get()
  @AdminRoute('status:manage')
  @Contract({
    operationId: 'adminListStatusIncidents',
    summary: 'Status page incidents (newest first)',
    tags: TAGS,
    query: adminIncidentQuerySchema,
    responses: { 200: adminIncidentPageSchema },
    errors: [403],
  })
  list(
    @Query() query: z.infer<typeof adminIncidentQuerySchema>,
  ): Promise<z.infer<typeof adminIncidentPageSchema>> {
    return this.incidents.list(query);
  }

  @Post()
  @AdminRoute('status:manage')
  @Contract({
    operationId: 'adminOpenStatusIncident',
    audit: ['status.incident_opened'],
    summary: 'Open an incident on the status page',
    description:
      'Shown at once on the status page and in the website and app banners; the affected components show at least the state the impact implies.',
    tags: TAGS,
    body: adminIncidentCreateSchema,
    responses: { 201: statusIncidentSchema },
    errors: [403],
  })
  open(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof adminIncidentCreateSchema>,
    @Req() request: Request,
  ): Promise<Incident> {
    return this.incidents.open(body, staffActor(auth, request));
  }

  @Post(':id/updates')
  @AdminRoute('status:manage')
  @Contract({
    operationId: 'adminUpdateStatusIncident',
    audit: ['status.incident_updated', 'status.incident_resolved'],
    summary: 'Post an update on an incident (resolving it with `resolved`)',
    description: 'A resolved incident accepts no further updates (409 `incident-resolved`).',
    tags: TAGS,
    params: adminIncidentParamsSchema,
    body: adminIncidentUpdateSchema,
    responses: { 201: statusIncidentSchema },
    errors: [403, 404, 409],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof adminIncidentUpdateSchema>,
    @Req() request: Request,
  ): Promise<Incident> {
    return this.incidents.update(id, body, staffActor(auth, request));
  }
}
