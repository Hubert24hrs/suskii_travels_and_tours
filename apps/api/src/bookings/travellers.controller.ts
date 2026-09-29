import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';

import type { TravellerInput } from '@suskii/shared';

import { CurrentAuth, type AuthContext, type AuthenticatedRequest } from '../auth/auth-context';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { BOOKING_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import {
  travellerIdParamsSchema,
  travellerListSchema,
  travellerRequestSchema,
  travellerSchema,
} from './bookings.schemas';
import { TravellersService } from './travellers.service';

const TAGS = ['Travellers'];

/** Saved travellers of the signed-in account (ADR-015). */
@Controller('me/travellers')
export class TravellersController {
  constructor(private readonly travellers: TravellersService) {}

  @Get()
  @Contract({
    operationId: 'listTravellers',
    summary: 'Saved travellers',
    tags: TAGS,
    responses: { 200: travellerListSchema },
  })
  async list(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof travellerListSchema>> {
    return { travellers: await this.travellers.list(auth.userId) };
  }

  @Post()
  @RateLimit(BOOKING_LIMITS.travellersUser)
  @Contract({
    operationId: 'createTraveller',
    summary: 'Save a traveller',
    description: 'At most 20 per account (409 `traveller-limit`).',
    tags: TAGS,
    body: travellerRequestSchema,
    responses: { 201: travellerSchema },
    errors: [409],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: TravellerInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof travellerSchema>> {
    return this.travellers.create(auth.userId, body, requestContext(request));
  }

  @Put(':travellerId')
  @RateLimit(BOOKING_LIMITS.travellersUser)
  @Contract({
    operationId: 'updateTraveller',
    summary: 'Replace a saved traveller',
    description:
      'A `document` without `number` keeps the stored passport number (clients only see its last three characters).',
    tags: TAGS,
    params: travellerIdParamsSchema,
    body: travellerRequestSchema,
    responses: { 200: travellerSchema },
    errors: [404],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('travellerId') travellerId: string,
    @Body() body: TravellerInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof travellerSchema>> {
    return this.travellers.update(auth.userId, travellerId, body, requestContext(request));
  }

  @Delete(':travellerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(BOOKING_LIMITS.travellersUser)
  @Contract({
    operationId: 'deleteTraveller',
    summary: 'Delete a saved traveller',
    tags: TAGS,
    params: travellerIdParamsSchema,
    responses: { 204: null },
    errors: [404],
  })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('travellerId') travellerId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.travellers.remove(auth.userId, travellerId, requestContext(request));
  }
}
