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
} from '@nestjs/common';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { bookingCaller } from '../bookings/booking-caller';
import { BOOKING_TOKEN_HEADER, quoteSchema } from '../bookings/bookings.schemas';
import { Contract } from '../contract/contract';
import { INHOUSE_LIMITS, RateLimit, SEARCH_LIMITS } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';
import { currencyQuerySchema } from '../search/search.schemas';

import { AddonLinksService } from './addon-links.service';
import { InhouseCatalogService } from './inhouse-catalog.service';
import { InhouseQuotesService } from './inhouse-quotes.service';
import {
  addonCardSchema,
  addonLinkRequestSchema,
  addonLinkSchema,
  addonListQuerySchema,
  addonListSchema,
  inhouseQuoteRequestSchema,
  packageDetailSchema,
  packageListQuerySchema,
  packageListSchema,
  slugParamsSchema,
  tourDetailSchema,
  tourListQuerySchema,
  tourListSchema,
  type AddonLinkRequest,
  type InhouseQuoteInput,
  type PackageListQuery,
  type TourListQuery,
} from './inhouse.schemas';

const detailQuerySchema = packageListQuerySchema.pick({
  currency: true,
  adults: true,
  children: true,
  infants: true,
});

/**
 * Suskii's own products (ADR-025, ADR-027): holiday packages, tours and travel add-ons, priced
 * for the caller, and quotes for them (visa assistance is quoted here too; its catalog lives
 * under `/visa`).
 */
@Public()
@Controller()
export class InhouseController {
  constructor(
    private readonly catalog: InhouseCatalogService,
    private readonly quotes: InhouseQuotesService,
    private readonly links: AddonLinksService,
  ) {}

  @Get('packages')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'listPackages',
    summary: 'Holiday packages with departures that fit the travellers',
    description:
      'Published packages with an open departure in the date range and room for the travellers. `fromPrice` is per adult, priced for the caller in the display currency; the budget filters apply to it.',
    tags: ['Packages'],
    query: packageListQuerySchema,
    responses: { 200: packageListSchema },
  })
  async listPackages(
    @Query() query: PackageListQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof packageListSchema>> {
    return { packages: await this.catalog.listPackages(query, clientContext(request)) };
  }

  @Get('packages/:slug')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'getPackage',
    summary: 'A package with its itinerary and departures',
    tags: ['Packages'],
    params: slugParamsSchema,
    query: detailQuerySchema,
    responses: { 200: packageDetailSchema },
    errors: [404],
  })
  getPackage(
    @Param('slug') slug: string,
    @Query() query: z.output<typeof detailQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof packageDetailSchema>> {
    return this.catalog.packageDetail(slug, query, clientContext(request));
  }

  @Get('tours')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'listTours',
    summary: 'Tours and activities',
    description:
      'Published tours matching the text (tour, city or country) with an open departure on the date and room for the travellers.',
    tags: ['Tours'],
    query: tourListQuerySchema,
    responses: { 200: tourListSchema },
  })
  async listTours(
    @Query() query: TourListQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof tourListSchema>> {
    return { tours: await this.catalog.listTours(query, clientContext(request)) };
  }

  @Get('tours/:slug')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'getTour',
    summary: 'A tour with its meeting point and departures',
    tags: ['Tours'],
    params: slugParamsSchema,
    query: detailQuerySchema,
    responses: { 200: tourDetailSchema },
    errors: [404],
  })
  getTour(
    @Param('slug') slug: string,
    @Query() query: z.output<typeof detailQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof tourDetailSchema>> {
    return this.catalog.tourDetail(slug, query, clientContext(request));
  }

  @Get('addons')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'listAddons',
    summary: 'Travel add-ons (insurance, transfers, eSIM, lounges)',
    tags: ['Add-ons'],
    query: addonListQuerySchema,
    responses: { 200: addonListSchema },
  })
  async listAddons(
    @Query() query: z.output<typeof addonListQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof addonListSchema>> {
    return { addons: await this.catalog.listAddons(query, clientContext(request)) };
  }

  @Get('addons/:slug')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'getAddon',
    summary: 'A travel add-on',
    tags: ['Add-ons'],
    params: slugParamsSchema,
    query: currencyQuerySchema,
    responses: { 200: addonCardSchema },
    errors: [404],
  })
  getAddon(
    @Param('slug') slug: string,
    @Query() query: z.output<typeof currencyQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof addonCardSchema>> {
    return this.catalog.addonDetail(slug, query.currency, clientContext(request));
  }

  @Post('addon-links')
  @HttpCode(HttpStatus.OK)
  @RateLimit(INHOUSE_LIMITS.addonLinkIp)
  @Contract({
    operationId: 'createAddonLink',
    summary: 'Attach add-ons to a trip',
    description:
      "From the booking page (`bookingId` with the session or `X-Booking-Token`) or with the booking reference and a traveller's last name. Answers a short-lived `linkToken` for add-on quotes and the trip facts add-ons need, never personal data. A wrong reference or name answers 404 either way; 409 `not-linkable` for trips that are not paid.",
    tags: ['Add-ons'],
    headers: [BOOKING_TOKEN_HEADER],
    body: addonLinkRequestSchema,
    responses: { 200: addonLinkSchema },
    errors: [404, 409],
  })
  link(
    @Body() body: AddonLinkRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof addonLinkSchema>> {
    return this.links.issue(body, bookingCaller(request));
  }

  @Post('inhouse-quotes')
  @RateLimit(SEARCH_LIMITS.quoteIp)
  @Contract({
    operationId: 'createInhouseQuote',
    summary: 'Quote a package, tour, visa assistance, add-on or Suskii Prime membership',
    description:
      'Checks the selection against the catalog (seats left, who may book, dates) and prices it for the caller; book it with `createBooking` like any quote. 422 `quote-invalid` carries `code`; 409 `sold-out`; 410 when the departure or product is no longer on sale. Memberships need a signed-in account (401) and book with one `guests` entry, the member.',
    tags: ['Bookings'],
    body: inhouseQuoteRequestSchema,
    responses: { 201: quoteSchema },
    errors: [401, 404, 409, 410, 422],
  })
  quote(
    @Body() body: InhouseQuoteInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof quoteSchema>> {
    return this.quotes.create(body, clientContext(request));
  }
}
