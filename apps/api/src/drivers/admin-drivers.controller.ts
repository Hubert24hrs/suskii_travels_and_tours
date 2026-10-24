import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { Contract, fileResponse } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';

import { DriverDocumentsService } from './driver-documents.service';
import {
  adminDriverListSchema,
  adminDriverQuerySchema,
  adminDriverSchema,
  approveDriverSchema,
  driverDocumentParamsSchema,
  driverIdParamsSchema,
  driverReasonSchema,
  driverVehicleParamsSchema,
  reviewDecisionSchema,
} from './drivers.schemas';
import { DriversAdminService } from './drivers-admin.service';

const TAGS = ['Admin'];

/** Driver applications, documents and vehicles for reviewers (`drivers:review`, ADR-050). */
@CarsFeatureRoute('rides')
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(
    private readonly admin: DriversAdminService,
    private readonly documents: DriverDocumentsService,
  ) {}

  @Get()
  @AdminRoute('drivers:review')
  @Contract({
    operationId: 'adminListDrivers',
    summary: 'Driver applications and drivers',
    tags: TAGS,
    query: adminDriverQuerySchema,
    responses: { 200: adminDriverListSchema },
    errors: [403],
  })
  list(
    @Query() query: z.output<typeof adminDriverQuerySchema>,
  ): Promise<z.infer<typeof adminDriverListSchema>> {
    return this.admin.list(query.status);
  }

  @Get(':driverId')
  @AdminRoute('drivers:review')
  @Contract({
    operationId: 'adminGetDriver',
    summary: 'A driver with documents, vehicles and check results',
    description: 'Identity numbers are never shown; KYC references are.',
    tags: TAGS,
    params: driverIdParamsSchema,
    responses: { 200: adminDriverSchema },
    errors: [403, 404],
  })
  detail(@Param('driverId') driverId: string): Promise<z.infer<typeof adminDriverSchema>> {
    return this.admin.detail(driverId);
  }

  @Get(':driverId/documents/:documentId/content')
  @AdminRoute('drivers:review')
  @Contract({
    operationId: 'adminGetDriverDocumentContent',
    summary: 'The file of a driver document (every read is audited)',
    tags: TAGS,
    params: driverDocumentParamsSchema,
    responses: { 200: fileResponse('application/octet-stream') },
    audit: ['driver.document_accessed'],
    errors: [403, 404],
  })
  async content(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId') driverId: string,
    @Param('documentId') documentId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.content(driverId, documentId, staffActor(auth, request));
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      disposition: `attachment; filename="${file.kind}-${documentId}"`,
      length: file.bytes.byteLength,
    });
  }

  @Post(':driverId/documents/:documentId/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('drivers:review')
  @Contract({
    operationId: 'adminReviewDriverDocument',
    summary: 'Approve or reject a document',
    tags: TAGS,
    params: driverDocumentParamsSchema,
    body: reviewDecisionSchema,
    responses: { 204: null },
    audit: ['driver.document_reviewed'],
    errors: [403, 404, 409, 422],
  })
  async reviewDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId') driverId: string,
    @Param('documentId') documentId: string,
    @Body() body: z.output<typeof reviewDecisionSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.reviewDocument(driverId, documentId, body, staffActor(auth, request));
  }

  @Post(':driverId/vehicles/:vehicleId/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('drivers:review')
  @Contract({
    operationId: 'adminReviewDriverVehicle',
    summary: 'Approve or reject a vehicle',
    tags: TAGS,
    params: driverVehicleParamsSchema,
    body: reviewDecisionSchema,
    responses: { 204: null },
    audit: ['driver.vehicle_reviewed'],
    errors: [403, 404, 422],
  })
  async reviewVehicle(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId') driverId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() body: z.output<typeof reviewDecisionSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.reviewVehicle(driverId, vehicleId, body, staffActor(auth, request));
  }

  @Post(':driverId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('drivers:review')
  @StepUp()
  @Contract({
    operationId: 'adminApproveDriver',
    summary: 'Approve a driver (grants the driver role)',
    description:
      '409 `driver-not-ready` with `missing` until identity and licence are verified, every document is approved and a vehicle is approved and insured.',
    tags: TAGS,
    params: driverIdParamsSchema,
    body: approveDriverSchema,
    responses: { 204: null },
    audit: ['driver.approved'],
    errors: [403, 404, 409],
  })
  async approve(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId') driverId: string,
    @Body() body: z.output<typeof approveDriverSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.approve(driverId, body, staffActor(auth, request));
  }

  @Post(':driverId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('drivers:review')
  @Contract({
    operationId: 'adminRejectDriver',
    summary: 'Reject an application',
    tags: TAGS,
    params: driverIdParamsSchema,
    body: driverReasonSchema,
    responses: { 204: null },
    audit: ['driver.rejected'],
    errors: [403, 404, 409],
  })
  async reject(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId') driverId: string,
    @Body() body: z.output<typeof driverReasonSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.reject(driverId, body.reason, staffActor(auth, request));
  }

  @Post(':driverId/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('drivers:review')
  @Contract({
    operationId: 'adminSuspendDriver',
    summary: 'Suspend a driver (offline at once, offers withdrawn)',
    tags: TAGS,
    params: driverIdParamsSchema,
    body: driverReasonSchema,
    responses: { 204: null },
    audit: ['driver.suspended'],
    errors: [403, 404, 409],
  })
  async suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId') driverId: string,
    @Body() body: z.output<typeof driverReasonSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.suspend(driverId, body.reason, staffActor(auth, request));
  }

  @Post(':driverId/reinstate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('drivers:review')
  @StepUp()
  @Contract({
    operationId: 'adminReinstateDriver',
    summary: 'Reinstate a suspended driver',
    tags: TAGS,
    params: driverIdParamsSchema,
    responses: { 204: null },
    audit: ['driver.reinstated'],
    errors: [403, 404, 409],
  })
  async reinstate(
    @CurrentAuth() auth: AuthContext,
    @Param('driverId') driverId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.reinstate(driverId, staffActor(auth, request));
  }
}
