import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute, StepUp } from '../auth/decorators';
import { Contract } from '../contract/contract';

import { PriceIntelAdminService } from './price-intel-admin.service';
import {
  budgetInputSchema,
  budgetLineSchema,
  jobQuerySchema,
  killSwitchInputSchema,
  killSwitchListSchema,
  observationQuerySchema,
  priceIntelOverviewSchema,
  priceObservationListSchema,
  priceReadInputSchema,
  priceReadResultSchema,
  priceSourceInputSchema,
  priceSourceListSchema,
  priceSourcePatchSchema,
  priceSourceSchema,
  scrapeJobListSchema,
  scrapingRegisterSchema,
  sourceApprovalSchema,
  sourceIdParamsSchema,
  type BudgetInput,
  type KillSwitchInput,
  type PriceIntelOverview,
  type PriceReadInput,
  type PriceReadResult,
  type PriceSourceDto,
  type PriceSourceInput,
  type PriceSourcePatch,
  type SourceApproval,
} from './price-intel.schemas';
import { PriceIntelService } from './price-intel.service';
import { PriceSourcesService } from './price-sources.service';

const TAGS = ['Admin'];
type Switches = z.infer<typeof killSwitchListSchema>;

/**
 * "Data Sources" in the console (ADR-102): the sites price intelligence may read, the policy of
 * each, the vendors, switches, budgets, reads and the legal register.
 */
@Controller('admin/data-sources')
export class AdminPriceIntelController {
  constructor(
    private readonly sources: PriceSourcesService,
    private readonly intel: PriceIntelService,
    private readonly admin: PriceIntelAdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListPriceSources',
    summary: 'The sites price intelligence may read, each with its policy',
    tags: TAGS,
    responses: { 200: priceSourceListSchema },
    errors: [403],
  })
  async list(): Promise<z.infer<typeof priceSourceListSchema>> {
    return { items: await this.sources.list() };
  }

  @Get('overview')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetPriceIntelOverview',
    summary: 'Vendors, switches, budgets and site counts',
    description:
      'Each enabled vendor with whether its key works, what is switched off, spend today and this month against each cap, and how many sites are in review, approved and blocked.',
    tags: TAGS,
    responses: { 200: priceIntelOverviewSchema },
    errors: [403],
  })
  overview(): Promise<PriceIntelOverview> {
    return this.admin.overview();
  }

  @Get('register')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminGetScrapingRegister',
    summary: 'The register of sites: status, basis and what each site says about automated access',
    tags: TAGS,
    responses: { 200: scrapingRegisterSchema },
    errors: [403],
  })
  register(): Promise<z.infer<typeof scrapingRegisterSchema>> {
    return this.admin.register();
  }

  @Get('jobs')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListScrapeJobs',
    summary: 'Recent reads with every attempt',
    tags: TAGS,
    query: jobQuerySchema,
    responses: { 200: scrapeJobListSchema },
    errors: [403],
  })
  jobs(
    @Query() query: z.infer<typeof jobQuerySchema>,
  ): Promise<z.infer<typeof scrapeJobListSchema>> {
    return this.admin.jobs(query);
  }

  @Post()
  @AdminRoute('datasources:manage')
  @Contract({
    operationId: 'adminCreatePriceSource',
    summary: 'List a site',
    description:
      'The site starts in review: only the mock vendor answers for it, and in production nothing is read until it is approved.',
    tags: TAGS,
    body: priceSourceInputSchema,
    responses: { 201: priceSourceSchema },
    errors: [403, 409],
    audit: ['price_intel.source_created'],
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: PriceSourceInput,
    @Req() request: Request,
  ): Promise<PriceSourceDto> {
    return this.sources.create(body, staffActor(auth, request));
  }

  @Patch(':sourceId')
  @AdminRoute('datasources:manage')
  @Contract({
    operationId: 'adminUpdatePriceSource',
    summary: "Change a site's details, recipes or policy",
    description:
      'Changing the vendors, the proxy limit, the rate, the page addresses or the robots and terms findings of an approved site sends it back to review. Changing a recipe closes its parser drift incident.',
    tags: TAGS,
    params: sourceIdParamsSchema,
    body: priceSourcePatchSchema,
    responses: { 200: priceSourceSchema },
    errors: [403, 404],
    audit: ['price_intel.source_updated'],
  })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('sourceId') sourceId: string,
    @Body() body: PriceSourcePatch,
    @Req() request: Request,
  ): Promise<PriceSourceDto> {
    return this.sources.update(sourceId, body, staffActor(auth, request));
  }

  @Post(':sourceId/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('datasources:manage')
  @StepUp()
  @Contract({
    operationId: 'adminApprovePriceSource',
    summary: 'Approve a site for reading, with the basis for it',
    description:
      "Needs the robots file and the terms to have been read. When either disallows automated access, only the site's own licence or permission is a basis.",
    tags: TAGS,
    params: sourceIdParamsSchema,
    body: sourceApprovalSchema,
    responses: { 200: priceSourceSchema },
    errors: [403, 404, 409, 422],
    audit: ['price_intel.source_approved'],
  })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('sourceId') sourceId: string,
    @Body() body: SourceApproval,
    @Req() request: Request,
  ): Promise<PriceSourceDto> {
    return this.sources.approve(sourceId, body, staffActor(auth, request));
  }

  @Post(':sourceId/block')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('datasources:manage')
  @Contract({
    operationId: 'adminBlockPriceSource',
    summary: 'Block a site: never read, by any vendor, in any environment',
    tags: TAGS,
    params: sourceIdParamsSchema,
    responses: { 200: priceSourceSchema },
    errors: [403, 404, 409],
    audit: ['price_intel.source_blocked'],
  })
  block(
    @CurrentAuth() auth: AuthContext,
    @Param('sourceId') sourceId: string,
    @Req() request: Request,
  ): Promise<PriceSourceDto> {
    return this.sources.block(sourceId, staffActor(auth, request));
  }

  @Post(':sourceId/review')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('datasources:manage')
  @Contract({
    operationId: 'adminReviewPriceSource',
    summary: 'Send a site back to review',
    tags: TAGS,
    params: sourceIdParamsSchema,
    responses: { 200: priceSourceSchema },
    errors: [403, 404, 409],
    audit: ['price_intel.source_reviewed'],
  })
  review(
    @CurrentAuth() auth: AuthContext,
    @Param('sourceId') sourceId: string,
    @Req() request: Request,
  ): Promise<PriceSourceDto> {
    return this.sources.review(sourceId, staffActor(auth, request));
  }

  @Post(':sourceId/read')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('datasources:manage')
  @Contract({
    operationId: 'adminReadPriceSource',
    summary: 'Read a site now for one question',
    description:
      'For checking a recipe. The policy applies as for any read: a site in review is answered by the mock vendor only, a blocked one by nobody.',
    tags: TAGS,
    params: sourceIdParamsSchema,
    body: priceReadInputSchema,
    responses: { 200: priceReadResultSchema },
    errors: [403, 404, 422],
    audit: ['price_intel.read_requested'],
  })
  async read(
    @CurrentAuth() auth: AuthContext,
    @Param('sourceId') sourceId: string,
    @Body() body: PriceReadInput,
    @Req() request: Request,
  ): Promise<PriceReadResult> {
    if (!this.intel.enabled()) throw new NotFoundException();
    const staff = staffActor(auth, request);
    const result = await this.intel.read(sourceId, body, 'staff');
    await this.audit.record({
      action: 'price_intel.read_requested',
      actorUserId: staff.userId,
      targetType: 'price_source',
      targetId: sourceId,
      metadata: { product: body.product, state: result.state, jobId: result.jobId },
      context: staff.context,
    });
    return result;
  }

  @Get(':sourceId/observations')
  @AdminRoute('ai:read')
  @Contract({
    operationId: 'adminListPriceObservations',
    summary: 'What a site was seen to charge, newest first',
    tags: TAGS,
    params: sourceIdParamsSchema,
    query: observationQuerySchema,
    responses: { 200: priceObservationListSchema },
    errors: [403, 404],
  })
  async observations(
    @Param('sourceId') sourceId: string,
    @Query() query: z.infer<typeof observationQuerySchema>,
  ): Promise<z.infer<typeof priceObservationListSchema>> {
    return { items: await this.intel.observations(sourceId, query) };
  }

  @Post('switches/stop')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('datasources:manage')
  @Contract({
    operationId: 'adminStopPriceIntel',
    summary: 'Switch off everything, one vendor or one site',
    description: 'Takes effect within seconds, on every instance. Needs no second check.',
    tags: TAGS,
    body: killSwitchInputSchema,
    responses: { 200: killSwitchListSchema },
    errors: [403, 409, 422],
    audit: ['price_intel.switched_off'],
  })
  async stop(
    @CurrentAuth() auth: AuthContext,
    @Body() body: KillSwitchInput,
    @Req() request: Request,
  ): Promise<Switches> {
    return { items: await this.admin.stop(body, staffActor(auth, request)) };
  }

  @Post('switches/release')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('datasources:manage')
  @StepUp()
  @Contract({
    operationId: 'adminReleasePriceIntel',
    summary: 'Switch back on',
    tags: TAGS,
    body: killSwitchInputSchema,
    responses: { 200: killSwitchListSchema },
    errors: [403, 409, 422],
    audit: ['price_intel.switched_on'],
  })
  async release(
    @CurrentAuth() auth: AuthContext,
    @Body() body: KillSwitchInput,
    @Req() request: Request,
  ): Promise<Switches> {
    return { items: await this.admin.release(body, staffActor(auth, request)) };
  }

  @Put('budgets')
  @AdminRoute('datasources:manage')
  @StepUp()
  @Contract({
    operationId: 'adminSetPriceIntelBudget',
    summary: 'Set what a vendor or a site may cost per day and month',
    description:
      'In millionths of a US dollar. At a cap nothing more is read until the period ends.',
    tags: TAGS,
    body: budgetInputSchema,
    responses: { 200: budgetLineSchema },
    errors: [403, 422],
    audit: ['price_intel.budget_changed'],
  })
  setBudget(
    @CurrentAuth() auth: AuthContext,
    @Body() body: BudgetInput,
    @Req() request: Request,
  ): Promise<z.infer<typeof budgetLineSchema>> {
    return this.admin.setBudget(body, staffActor(auth, request));
  }
}
