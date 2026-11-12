import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { staffActor } from '../admin/admin-helpers';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Contract, fileResponse } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { readUpload } from '../visa/upload-body';

import {
  adminReservationListSchema,
  adminReservationQuerySchema,
  adminVehicleListSchema,
  createdSchema,
  depositReleaseSchema,
  handoverBodySchema,
  idParamsSchema,
  licenceReviewSchema,
  photoCreatedSchema,
  reservationIdParamsSchema,
  vehicleBodySchema,
  vehicleUpdateSchema,
} from './rentals.schemas';
import { RentalsAdminService } from './rentals-admin.service';

const TAGS = ['Admin'];
const PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;
const photoParamsSchema = z.object({ reservationId: z.uuid(), photoId: z.uuid() });

const attachment = (
  response: Response,
  file: { bytes: Buffer; contentType: string },
  name: string,
) => {
  // Never let a browser render or run it: attachment, no sniffing, sandboxed if opened anyway.
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(file.bytes, {
    type: file.contentType,
    disposition: `attachment; filename="${name}"`,
    length: file.bytes.byteLength,
  });
};

/**
 * The rental desk (`ground:manage`, ADR-051): fleet, reservations, licence review, photo
 * evidence, check-out and check-in, and the deposit release.
 */
@CarsFeatureRoute('rentals')
@Controller('admin/rentals')
export class AdminRentalsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly admin: RentalsAdminService,
  ) {}

  @Get('vehicles')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListRentalVehicles',
    summary: 'The rental fleet',
    tags: TAGS,
    responses: { 200: adminVehicleListSchema },
    errors: [403],
  })
  vehicles(): Promise<z.infer<typeof adminVehicleListSchema>> {
    return this.admin.vehicles();
  }

  @Post('vehicles')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminCreateRentalVehicle',
    summary: 'Add a car (draft until published)',
    tags: TAGS,
    body: vehicleBodySchema,
    responses: { 201: createdSchema },
    audit: ['rental.vehicle_created'],
    errors: [403, 409, 422],
  })
  createVehicle(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof vehicleBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof createdSchema>> {
    return this.admin.createVehicle(body, staffActor(auth, request));
  }

  @Patch('vehicles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUpdateRentalVehicle',
    summary: 'Change, publish or withdraw a car',
    description: 'Booked rentals keep the rates they were quoted.',
    tags: TAGS,
    params: idParamsSchema,
    body: vehicleUpdateSchema,
    responses: { 204: null },
    audit: ['rental.vehicle_updated'],
    errors: [403, 404, 422],
  })
  async updateVehicle(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof vehicleUpdateSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.updateVehicle(id, body, staffActor(auth, request));
  }

  @Get('reservations')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminListRentalReservations',
    summary: 'Rentals with licences, handovers and deposits',
    tags: TAGS,
    query: adminReservationQuerySchema,
    responses: { 200: adminReservationListSchema },
    errors: [403],
  })
  reservations(
    @Query() query: z.output<typeof adminReservationQuerySchema>,
  ): Promise<z.infer<typeof adminReservationListSchema>> {
    return this.admin.reservations(query);
  }

  @Get('reservations/:reservationId/licence')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminGetRentalLicence',
    summary: "The renter's licence scan (every read is audited)",
    tags: TAGS,
    params: reservationIdParamsSchema,
    responses: { 200: fileResponse('application/octet-stream') },
    audit: ['rental.licence_accessed'],
    errors: [403, 404],
  })
  async licence(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.admin.licenceContent(reservationId, staffActor(auth, request));
    return attachment(response, file, `licence-${reservationId}`);
  }

  @Post('reservations/:reservationId/licence/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminReviewRentalLicence',
    summary: "Approve or reject the renter's licence",
    tags: TAGS,
    params: reservationIdParamsSchema,
    body: licenceReviewSchema,
    responses: { 204: null },
    audit: ['rental.licence_reviewed'],
    errors: [403, 404, 409, 422],
  })
  async reviewLicence(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Body() body: z.output<typeof licenceReviewSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.reviewLicence(reservationId, body, staffActor(auth, request));
  }

  @Post('reservations/:reservationId/photos')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminUploadRentalPhoto',
    summary: 'Upload a condition photo for the next handover',
    description: 'Raw JPEG or PNG body; virus-scanned and encrypted. Attach it in the handover.',
    tags: TAGS,
    params: reservationIdParamsSchema,
    upload: { contentTypes: PHOTO_TYPES, description: 'The photo.' },
    responses: { 201: photoCreatedSchema },
    audit: ['rental.photo_uploaded'],
    errors: [403, 404, 409, 413, 415, 422],
  })
  async uploadPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof photoCreatedSchema>> {
    const bytes = await readUpload(request, this.config.VISA_DOCUMENT_MAX_BYTES);
    return this.admin.uploadPhoto(reservationId, bytes, staffActor(auth, request));
  }

  @Get('reservations/:reservationId/photos/:photoId')
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminGetRentalPhoto',
    summary: 'A condition photo (every read is audited)',
    tags: TAGS,
    params: photoParamsSchema,
    responses: { 200: fileResponse('application/octet-stream') },
    audit: ['rental.photo_accessed'],
    errors: [403, 404],
  })
  async photo(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Param('photoId') photoId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.admin.photoContent(reservationId, photoId, staffActor(auth, request));
    return attachment(response, file, `photo-${photoId}`);
  }

  @Post('reservations/:reservationId/handovers')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminRecordRentalHandover',
    summary: 'Record check-out or check-in (cannot be changed afterwards)',
    description:
      'Check-out needs a confirmed booking and an approved licence in date (self-drive) or an approved driver as chauffeur. Check-in needs a check-out and an odometer reading no lower than it. 409 `rental-conflict` otherwise.',
    tags: TAGS,
    params: reservationIdParamsSchema,
    body: handoverBodySchema,
    responses: { 204: null },
    audit: ['rental.checked_out', 'rental.checked_in'],
    errors: [403, 404, 409, 422],
  })
  async handover(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Body() body: z.output<typeof handoverBodySchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.handover(reservationId, body, staffActor(auth, request));
  }

  @Post('reservations/:reservationId/deposit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('ground:manage')
  @Contract({
    operationId: 'adminReleaseRentalDeposit',
    summary: 'Release the deposit after check-in, keeping part of it with a reason',
    tags: TAGS,
    params: reservationIdParamsSchema,
    body: depositReleaseSchema,
    responses: { 204: null },
    audit: ['rental.deposit_released'],
    errors: [403, 404, 409, 422],
  })
  async releaseDeposit(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Body() body: z.output<typeof depositReleaseSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.admin.releaseDeposit(reservationId, body, staffActor(auth, request));
  }
}
