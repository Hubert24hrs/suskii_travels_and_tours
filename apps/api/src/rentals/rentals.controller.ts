import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { CarsFeatureRoute } from '../ground/cars-flags';
import { CARS_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';
import { readUpload } from '../visa/upload-body';
import { VISA_DOCUMENT_URL_TYPES } from '../visa/visa.schemas';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Inject } from '@nestjs/common';

import { RentalsCatalogService } from './rentals-catalog.service';
import {
  availabilityQuerySchema,
  availabilitySchema,
  licenceBodySchema,
  rentalSearchQuerySchema,
  rentalSearchResultSchema,
  rentalVehicleSchema,
  reservationIdParamsSchema,
  reservationSchema,
  slugParamsSchema,
  vehicleIdParamsSchema,
  type RentalSearchQuery,
} from './rentals.schemas';
import { RentalsService, type Renter } from './rentals.service';

const TAGS = ['Rentals'];

const renter = (auth: AuthContext, request: Request): Renter => ({
  userId: auth.userId,
  context: requestContext(request),
});

/**
 * Car rental for customers (ADR-049, ADR-051): free cars for a period, a car's page and blocked
 * dates, then the renter's licence for a self-drive booking. A rental is booked like everything
 * else (`createInhouseQuote` kind `rental`, a booking, a payment, signed in).
 */
@CarsFeatureRoute('rentals')
@Controller('rentals')
export class RentalsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly catalog: RentalsCatalogService,
    private readonly rentals: RentalsService,
  ) {}

  @Get('vehicles')
  @Public()
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'searchRentalVehicles',
    summary: 'Cars free for a period in a city',
    description:
      'Times are local to the branch (`YYYY-MM-DDTHH:mm`). 422 `quote-invalid` (`period_invalid`, `too_long`) for periods that cannot be booked.',
    tags: TAGS,
    query: rentalSearchQuerySchema,
    responses: { 200: rentalSearchResultSchema },
    errors: [422],
  })
  search(@Query() query: RentalSearchQuery): Promise<z.infer<typeof rentalSearchResultSchema>> {
    return this.catalog.search(query);
  }

  @Get('vehicles/:slug')
  @Public()
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'getRentalVehicle',
    summary: 'A rental car with its rates and policies',
    tags: TAGS,
    params: slugParamsSchema,
    responses: { 200: rentalVehicleSchema },
    errors: [404],
  })
  detail(@Param('slug') slug: string): Promise<z.infer<typeof rentalVehicleSchema>> {
    return this.catalog.detail(slug);
  }

  @Get('vehicles/:vehicleId/availability')
  @Public()
  @RateLimit(CARS_LIMITS.catalogIp)
  @Contract({
    operationId: 'getRentalAvailability',
    summary: 'Periods a car is taken between two dates',
    tags: TAGS,
    params: vehicleIdParamsSchema,
    query: availabilityQuerySchema,
    responses: { 200: availabilitySchema },
    errors: [404, 422],
  })
  availability(
    @Param('vehicleId') vehicleId: string,
    @Query() query: z.output<typeof availabilityQuerySchema>,
  ): Promise<z.infer<typeof availabilitySchema>> {
    return this.catalog.availability(vehicleId, query.from, query.to);
  }

  @Get('reservations/:reservationId')
  @Contract({
    operationId: 'getRentalReservation',
    summary: "Your rental's reservation and licence status",
    tags: TAGS,
    params: reservationIdParamsSchema,
    responses: { 200: reservationSchema },
    errors: [401, 404],
  })
  reservation(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
  ): Promise<z.infer<typeof reservationSchema>> {
    return this.rentals.get(reservationId, auth.userId);
  }

  @Put('reservations/:reservationId/licence')
  @RateLimit(CARS_LIMITS.uploadUser)
  @Contract({
    operationId: 'submitRentalLicence',
    summary: "Give your driver's licence for a self-drive rental",
    description:
      'The number is encrypted and shown back as its last three characters. It must be valid until the car is due back. Replaces an earlier licence until one is approved.',
    tags: TAGS,
    params: reservationIdParamsSchema,
    body: licenceBodySchema,
    responses: { 200: reservationSchema },
    audit: ['rental.licence_submitted'],
    errors: [401, 404, 409],
  })
  submitLicence(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Body() body: z.output<typeof licenceBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof reservationSchema>> {
    return this.rentals.submitLicence(reservationId, body, renter(auth, request));
  }

  @Put('reservations/:reservationId/licence/document')
  @HttpCode(HttpStatus.OK)
  @RateLimit(CARS_LIMITS.uploadUser)
  @Contract({
    operationId: 'uploadRentalLicence',
    summary: 'Upload a scan or photo of your licence',
    description:
      'Send the raw file as the body: PDF, JPEG or PNG, detected from the bytes (415 `document-type`), at most VISA_DOCUMENT_MAX_BYTES (413). Encrypted at rest, virus-scanned, then reviewed by staff before check-out.',
    tags: TAGS,
    params: reservationIdParamsSchema,
    upload: { contentTypes: VISA_DOCUMENT_URL_TYPES, description: 'The file itself.' },
    responses: { 200: reservationSchema },
    audit: ['rental.licence_uploaded'],
    errors: [401, 404, 409, 413, 415],
  })
  async uploadLicence(
    @CurrentAuth() auth: AuthContext,
    @Param('reservationId') reservationId: string,
    @Req() request: Request,
  ): Promise<z.infer<typeof reservationSchema>> {
    // Ownership before reading the body: strangers upload nothing.
    await this.rentals.get(reservationId, auth.userId);
    const bytes = await readUpload(request, this.config.VISA_DOCUMENT_MAX_BYTES);
    return this.rentals.uploadLicence(reservationId, bytes, renter(auth, request));
  }
}
