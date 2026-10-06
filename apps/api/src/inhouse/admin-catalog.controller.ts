import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract } from '../contract/contract';
import { INHOUSE_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';

import { CatalogAdminService, type StaffActor } from './catalog-admin.service';
import {
  adminProductListSchema,
  adminProductQuerySchema,
  catalogCreatedSchema,
  createAddonSchema,
  createPackageDepartureSchema,
  createPackageSchema,
  createTourDepartureSchema,
  createTourSchema,
  createVisaProductSchema,
  idParamsSchema,
  redeemedVoucherSchema,
  redeemVoucherRequestSchema,
  updateAddonSchema,
  updateDepartureSchema,
  updatePackageSchema,
  updateTourSchema,
  updateVisaProductSchema,
} from './inhouse.schemas';
import { VouchersService } from './vouchers.service';

const TAGS = ['Admin'];

const staff = (auth: AuthContext, request: Request): StaffActor => ({
  userId: auth.userId,
  context: requestContext(request),
});

type Created = z.infer<typeof catalogCreatedSchema>;

/**
 * Catalog management and voucher redemption for operations (ADR-025, ADR-028). Admin routes need
 * a staff role, an MFA session and an allowlisted IP. The console UI arrives in phase 10.
 */
@Controller('admin')
export class AdminCatalogController {
  constructor(
    private readonly catalog: CatalogAdminService,
    private readonly vouchers: VouchersService,
  ) {}

  @Get('catalog')
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminListCatalog',
    summary: 'List products of one kind, with departures and seat counts',
    tags: TAGS,
    query: adminProductQuerySchema,
    responses: { 200: adminProductListSchema },
    errors: [403],
  })
  async list(
    @Query() query: z.output<typeof adminProductQuerySchema>,
  ): Promise<z.infer<typeof adminProductListSchema>> {
    return { products: await this.catalog.list(query.kind, query.status) };
  }

  @Post('packages')
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminCreatePackage',
    audit: ['catalog.created'],
    summary: 'Create a package (draft)',
    tags: TAGS,
    body: createPackageSchema,
    responses: { 201: catalogCreatedSchema },
    errors: [403, 409, 422],
  })
  createPackage(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createPackageSchema>,
    @Req() request: Request,
  ): Promise<Created> {
    return this.catalog.createPackage(body, staff(auth, request));
  }

  @Patch('packages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminUpdatePackage',
    audit: ['catalog.updated', 'catalog.status_changed'],
    summary: 'Update, publish or archive a package',
    tags: TAGS,
    params: idParamsSchema,
    body: updatePackageSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async updatePackage(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updatePackageSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.catalog.updatePackage(id, body, staff(auth, request));
  }

  @Post('packages/:id/departures')
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminCreatePackageDeparture',
    audit: ['catalog.departure_created'],
    summary: 'Add a dated departure with capacity and per-person base prices',
    tags: TAGS,
    params: idParamsSchema,
    body: createPackageDepartureSchema,
    responses: { 201: catalogCreatedSchema },
    errors: [403, 404],
  })
  createPackageDeparture(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof createPackageDepartureSchema>,
    @Req() request: Request,
  ): Promise<Created> {
    return this.catalog.createPackageDeparture(id, body, staff(auth, request));
  }

  @Patch('package-departures/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminUpdatePackageDeparture',
    audit: ['catalog.departure_updated'],
    summary: 'Change capacity, prices or status of a package departure',
    description: '409 `capacity-below-booked` when the capacity would drop below reserved + sold.',
    tags: TAGS,
    params: idParamsSchema,
    body: updateDepartureSchema,
    responses: { 204: null },
    errors: [403, 404, 409],
  })
  async updatePackageDeparture(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateDepartureSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.catalog.updateDeparture('package', id, body, staff(auth, request));
  }

  @Post('tours')
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminCreateTour',
    audit: ['catalog.created'],
    summary: 'Create a tour (draft)',
    tags: TAGS,
    body: createTourSchema,
    responses: { 201: catalogCreatedSchema },
    errors: [403, 409, 422],
  })
  createTour(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createTourSchema>,
    @Req() request: Request,
  ): Promise<Created> {
    return this.catalog.createTour(body, staff(auth, request));
  }

  @Patch('tours/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminUpdateTour',
    audit: ['catalog.updated', 'catalog.status_changed'],
    summary: 'Update, publish or archive a tour',
    tags: TAGS,
    params: idParamsSchema,
    body: updateTourSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async updateTour(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateTourSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.catalog.updateTour(id, body, staff(auth, request));
  }

  @Post('tours/:id/departures')
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminCreateTourDeparture',
    audit: ['catalog.departure_created'],
    summary: 'Add a departure (local time at the meeting point)',
    tags: TAGS,
    params: idParamsSchema,
    body: createTourDepartureSchema,
    responses: { 201: catalogCreatedSchema },
    errors: [403, 404],
  })
  createTourDeparture(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof createTourDepartureSchema>,
    @Req() request: Request,
  ): Promise<Created> {
    return this.catalog.createTourDeparture(id, body, staff(auth, request));
  }

  @Patch('tour-departures/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminUpdateTourDeparture',
    audit: ['catalog.departure_updated'],
    summary: 'Change capacity, prices or status of a tour departure',
    tags: TAGS,
    params: idParamsSchema,
    body: updateDepartureSchema,
    responses: { 204: null },
    errors: [403, 404, 409],
  })
  async updateTourDeparture(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateDepartureSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.catalog.updateDeparture('tour', id, body, staff(auth, request));
  }

  @Post('addons')
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminCreateAddon',
    audit: ['catalog.created'],
    summary: 'Create an add-on (draft)',
    tags: TAGS,
    body: createAddonSchema,
    responses: { 201: catalogCreatedSchema },
    errors: [403, 409],
  })
  createAddon(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createAddonSchema>,
    @Req() request: Request,
  ): Promise<Created> {
    return this.catalog.createAddon(body, staff(auth, request));
  }

  @Patch('addons/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminUpdateAddon',
    audit: ['catalog.updated', 'catalog.status_changed'],
    summary: 'Update, publish or archive an add-on',
    tags: TAGS,
    params: idParamsSchema,
    body: updateAddonSchema,
    responses: { 204: null },
    errors: [403, 404],
  })
  async updateAddon(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateAddonSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.catalog.updateAddon(id, body, staff(auth, request));
  }

  @Post('visa-products')
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminCreateVisaProduct',
    audit: ['catalog.created'],
    summary: 'Create a visa assistance product (draft)',
    tags: TAGS,
    body: createVisaProductSchema,
    responses: { 201: catalogCreatedSchema },
    errors: [403, 409],
  })
  createVisaProduct(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.output<typeof createVisaProductSchema>,
    @Req() request: Request,
  ): Promise<Created> {
    return this.catalog.createVisaProduct(body, staff(auth, request));
  }

  @Patch('visa-products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoute('catalog:manage')
  @Contract({
    operationId: 'adminUpdateVisaProduct',
    audit: ['catalog.updated', 'catalog.status_changed'],
    summary: 'Update, publish or archive a visa assistance product',
    tags: TAGS,
    params: idParamsSchema,
    body: updateVisaProductSchema,
    responses: { 204: null },
    errors: [403, 404, 422],
  })
  async updateVisaProduct(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.output<typeof updateVisaProductSchema>,
    @Req() request: Request,
  ): Promise<void> {
    await this.catalog.updateVisaProduct(id, body, staff(auth, request));
  }

  @Post('vouchers/redeem')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('bookings:manage')
  @RateLimit(INHOUSE_LIMITS.voucherRedeemUser)
  @Contract({
    operationId: 'adminRedeemVoucher',
    audit: ['booking.voucher_redeemed'],
    summary: 'Redeem a voucher (typed code or scanned QR)',
    description:
      'Once per voucher: 409 `voucher-redeemed` with `redeemedAt` afterwards. Unknown codes and vouchers of cancelled bookings answer 404. The answer carries no personal data.',
    tags: TAGS,
    body: redeemVoucherRequestSchema,
    responses: { 200: redeemedVoucherSchema },
    errors: [403, 404, 409],
  })
  redeem(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof redeemVoucherRequestSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof redeemedVoucherSchema>> {
    return this.vouchers.redeem(body.code, staff(auth, request));
  }
}
