import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { bookingCaller } from '../bookings/booking-caller';
import { BOOKING_TOKEN_HEADER, bookingIdParamsSchema } from '../bookings/bookings.schemas';
import { Contract } from '../contract/contract';
import { PARTNER_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';

import { PartnerClicksService } from './partner-clicks.service';
import { PartnerConversionsService } from './partner-conversions.service';
import { PartnerOffersService } from './partner-offers.service';
import {
  bookingPartnerOffersQuerySchema,
  partnerLinkParamsSchema,
  partnerOffersQuerySchema,
  partnerOffersSchema,
  postbackBodySchema,
  postbackParamsSchema,
  postbackQuerySchema,
  postbackResultSchema,
  postbackTokenQuerySchema,
  type PartnerOffersDto,
  type PartnerOffersQuery,
} from './partners.schemas';

const TAGS = ['Partners'];

/**
 * Affiliate partner offers (ADR-069, ADR-070): offers for a place or a booked trip, the tracked
 * redirect to the partner, and the networks' conversion postbacks. Public: offers are not
 * personal, the redirect needs a sealed token and postbacks need the network's secret.
 */
@Public()
@Controller()
export class PartnersController {
  constructor(
    private readonly offers: PartnerOffersService,
    private readonly clicks: PartnerClicksService,
    private readonly conversions: PartnerConversionsService,
  ) {}

  @Get('partners/offers')
  @RateLimit(PARTNER_LIMITS.offersIp)
  @Contract({
    operationId: 'getPartnerOffers',
    summary: 'Car rental, transfers, activities, eSIMs and insurance from partners for a place',
    description:
      'Partner pages for each category and priced activities for the place and dates. The traveller books on the partner site through `href`; Suskii earns a commission and does not take the payment. 404 while partner offers are off.',
    tags: TAGS,
    query: partnerOffersQuerySchema,
    responses: { 200: partnerOffersSchema },
    errors: [404],
  })
  forPlace(
    @Query() query: PartnerOffersQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<PartnerOffersDto> {
    this.offers.requireEnabled();
    return this.offers.forPlace(query, clientContext(request));
  }

  @Get('bookings/:bookingId/partner-offers')
  @RateLimit(PARTNER_LIMITS.offersIp)
  @Contract({
    operationId: 'getBookingPartnerOffers',
    summary: 'Partner offers for a booked trip',
    description:
      "Offers for the trip's destination and dates (transfers, a car, an eSIM, insurance, activities). Empty for a cancelled or past trip. Owners use their session, guests the booking's access token. 404 while partner offers are off.",
    tags: TAGS,
    params: bookingIdParamsSchema,
    query: bookingPartnerOffersQuerySchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: partnerOffersSchema },
    errors: [404],
  })
  forBooking(
    @Param('bookingId') bookingId: string,
    @Query() query: z.infer<typeof bookingPartnerOffersQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<PartnerOffersDto> {
    this.offers.requireEnabled();
    return this.offers.forBooking(bookingId, query.currency, bookingCaller(request));
  }

  @Get('go/:token')
  @HttpCode(HttpStatus.FOUND)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit(PARTNER_LIMITS.redirectIp)
  @Contract({
    operationId: 'followPartnerLink',
    summary: 'Open a partner offer',
    description:
      "Records the click and redirects (302) to the partner, with the network's tracking. Only follows links this API sealed, and only to the partner's own hosts. An expired link still reaches the partner without naming the viewer.",
    tags: TAGS,
    params: partnerLinkParamsSchema,
    responses: { 302: null },
    errors: [404],
  })
  async follow(
    @Param('token') token: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    response.setHeader('Location', await this.clicks.follow(token, clientContext(request)));
  }

  @Get('partners/postbacks/:network')
  @RateLimit(PARTNER_LIMITS.postbackIp)
  @Contract({
    operationId: 'partnerPostbackGet',
    summary: 'Record a conversion reported by a network (GET)',
    description:
      'Called by the affiliate network with its macros mapped to the documented parameters and `token` set to the postback secret. Status words: processing, pending, booked; paid, confirmed, approved; cancelled, canceled, rejected, declined. 400 for a malformed postback (the network retries), 404 while the network has no postback secret.',
    tags: TAGS,
    params: postbackParamsSchema,
    query: postbackQuerySchema,
    responses: { 200: postbackResultSchema },
    errors: [401, 404, 409],
  })
  postbackGet(
    @Param() params: z.infer<typeof postbackParamsSchema>,
    @Query() query: z.infer<typeof postbackQuerySchema>,
  ): Promise<z.infer<typeof postbackResultSchema>> {
    const { token, ...input } = query;
    this.conversions.authorise(params.network, token);
    return this.conversions.record(params.network, input);
  }

  @Post('partners/postbacks/:network')
  @HttpCode(HttpStatus.OK)
  @RateLimit(PARTNER_LIMITS.postbackIp)
  @Contract({
    operationId: 'partnerPostback',
    summary: 'Record a conversion reported by a network (POST)',
    description:
      'The same as the GET form with the fields in a JSON body and `token` in the query string.',
    tags: TAGS,
    params: postbackParamsSchema,
    query: postbackTokenQuerySchema,
    body: postbackBodySchema,
    responses: { 200: postbackResultSchema },
    errors: [401, 404, 409],
  })
  postback(
    @Param() params: z.infer<typeof postbackParamsSchema>,
    @Query() query: z.infer<typeof postbackTokenQuerySchema>,
    @Body() body: z.infer<typeof postbackBodySchema>,
  ): Promise<z.infer<typeof postbackResultSchema>> {
    this.conversions.authorise(params.network, query.token);
    return this.conversions.record(params.network, body);
  }
}
