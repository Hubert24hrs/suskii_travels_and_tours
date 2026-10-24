import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import type {
  DriverApplicationInput,
  DriverDocumentKind,
  DriverVehicleInput,
} from '@suskii/shared';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { ReauthService } from '../auth/reauth.service';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';
import { readUpload } from '../visa/upload-body';
import { VISA_DOCUMENT_URL_TYPES } from '../visa/visa.schemas';

import { DriverDocumentsService } from './driver-documents.service';
import {
  documentKindParamsSchema,
  driverApplicationBodySchema,
  driverProfileSchema,
  driverVehicleBodySchema,
  payoutAccountBodySchema,
  vehicleIdParamsSchema,
} from './drivers.schemas';
import { DriversService, type DriverActor } from './drivers.service';

const TAGS = ['Drivers'];

const actor = (auth: AuthContext, request: Request): DriverActor => ({
  userId: auth.userId,
  context: requestContext(request),
});

/**
 * Becoming a driver (ADR-050): any signed-in account can apply. The NIN and licence are checked
 * through the KYC adapter; documents are uploaded raw, encrypted and virus-scanned; staff review
 * everything before the account gets the `driver` role. Identity numbers are never returned.
 */
@CarsFeatureRoute('rides')
@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly documents: DriverDocumentsService,
    private readonly reauth: ReauthService,
  ) {}

  @Post('applications')
  @RateLimit(CARS_LIMITS.applyUser)
  @Contract({
    operationId: 'applyToDrive',
    summary: 'Apply to drive',
    description:
      'One application per account and per person (409 `driver-exists`). 422 `driver-too-young` under 18, `licence-expiring` with under 30 days left. A KYC check the provider could not answer stays `pending` for a staff member to complete.',
    tags: TAGS,
    body: driverApplicationBodySchema,
    responses: { 201: driverProfileSchema },
    audit: ['driver.applied'],
    errors: [401, 409, 422],
  })
  apply(
    @CurrentAuth() auth: AuthContext,
    @Body() body: DriverApplicationInput,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverProfileSchema>> {
    return this.drivers.apply(body, actor(auth, request));
  }

  @Get('me/profile')
  @Contract({
    operationId: 'getDriverProfile',
    summary: 'Your driver profile and what is still missing',
    tags: TAGS,
    responses: { 200: driverProfileSchema },
    errors: [401, 404],
  })
  profile(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof driverProfileSchema>> {
    return this.drivers.profile(auth.userId);
  }

  @Put('me/documents/:kind')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.uploadUser)
  @Contract({
    operationId: 'uploadDriverDocument',
    summary: 'Upload a document (licence, registration, insurance, roadworthiness, selfie)',
    description:
      'Send the raw file as the body: PDF, JPEG or PNG, detected from the bytes (415 `document-type`), at most VISA_DOCUMENT_MAX_BYTES (413). Replaces an earlier upload of the kind; staff review it after a virus scan.',
    tags: TAGS,
    params: documentKindParamsSchema,
    upload: { contentTypes: VISA_DOCUMENT_URL_TYPES, description: 'The file itself.' },
    responses: { 200: driverProfileSchema },
    audit: ['driver.document_uploaded'],
    errors: [401, 404, 409, 413, 415],
  })
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Param('kind') kind: DriverDocumentKind,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverProfileSchema>> {
    // The applicant first: strangers upload nothing.
    const driver = await this.drivers.load(auth.userId);
    const bytes = await readUpload(request, this.documents.maxBytes);
    await this.documents.upload(driver.id, kind, bytes, actor(auth, request));
    return this.drivers.profile(auth.userId);
  }

  @Post('me/vehicles')
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'addDriverVehicle',
    summary: 'Register a vehicle for review',
    description: 'At most three; 409 `plate-taken` for a plate already registered.',
    tags: TAGS,
    body: driverVehicleBodySchema,
    responses: { 201: driverProfileSchema },
    audit: ['driver.vehicle_added'],
    errors: [401, 404, 409, 422],
  })
  addVehicle(
    @CurrentAuth() auth: AuthContext,
    @Body() body: DriverVehicleInput,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverProfileSchema>> {
    return this.drivers.addVehicle(body, actor(auth, request));
  }

  @Post('me/vehicles/:vehicleId/activate')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'activateDriverVehicle',
    summary: 'Drive an approved vehicle from now on',
    tags: TAGS,
    params: vehicleIdParamsSchema,
    responses: { 200: driverProfileSchema },
    errors: [401, 404, 409],
  })
  activate(
    @CurrentAuth() auth: AuthContext,
    @Param('vehicleId') vehicleId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverProfileSchema>> {
    return this.drivers.activateVehicle(vehicleId, actor(auth, request));
  }

  @Put('me/payout-account')
  @RateLimit(CARS_LIMITS.driverActionUser)
  @Contract({
    operationId: 'setDriverPayoutAccount',
    summary: 'Set the bank account payouts go to',
    description:
      'Needs a sign-in in the last few minutes or re-authentication (401 `reauthentication-required`): redirecting payouts is what an account takeover would try first.',
    tags: TAGS,
    body: payoutAccountBodySchema,
    responses: { 200: driverProfileSchema },
    audit: ['driver.payout_account_updated'],
    errors: [401, 404],
  })
  async payoutAccount(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof payoutAccountBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof driverProfileSchema>> {
    await this.drivers.load(auth.userId);
    await this.reauth.confirmRecent(auth, body.reauth, requestContext(request));
    return this.drivers.setPayoutAccount(body.account, actor(auth, request));
  }
}
