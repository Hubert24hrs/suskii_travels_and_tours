import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { AdminRoute } from '../auth/decorators';
import { Contract } from '../contract/contract';

import {
  adminCmsBlockListSchema,
  adminCmsBlockSchema,
  adminFaqListSchema,
  adminFaqSchema,
  adminTrustSignalListSchema,
  adminTrustSignalSchema,
  cmsBlockListQuerySchema,
  cmsBlockParamsSchema,
  faqInputSchema,
  faqListQuerySchema,
  faqPatchSchema,
  saveCmsBlockBodySchema,
  trustSignalParamsSchema,
  trustSignalPatchSchema,
  unverifyTrustSignalBodySchema,
  verifyTrustSignalBodySchema,
} from './admin-content.schemas';
import { AdminContentService } from './admin-content.service';
import { adminIdParamsSchema } from './admin-deals.schemas';
import { staffActor } from './admin-helpers';

const TAGS = ['Admin'];
const SHOWN_WITHIN = 'The public site shows the change within its five-minute cache window.';

@Controller('admin')
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get('content/blocks')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminListCmsBlocks',
    summary: 'CMS blocks, published or not',
    tags: TAGS,
    query: cmsBlockListQuerySchema,
    responses: { 200: adminCmsBlockListSchema },
    errors: [403],
  })
  listBlocks(
    @Query() query: z.infer<typeof cmsBlockListQuerySchema>,
  ): Promise<z.infer<typeof adminCmsBlockListSchema>> {
    return this.content.listBlocks(query.locale);
  }

  @Put('content/blocks/:locale/:key')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminSaveCmsBlock',
    summary: 'Save, publish or unpublish a CMS block',
    description: `Content is validated against the schema the public site parses for the key. ${SHOWN_WITHIN}`,
    tags: TAGS,
    params: cmsBlockParamsSchema,
    body: saveCmsBlockBodySchema,
    responses: { 200: adminCmsBlockSchema },
    errors: [403],
    audit: ['cms.block_saved'],
  })
  saveBlock(
    @CurrentAuth() auth: AuthContext,
    @Param() params: z.infer<typeof cmsBlockParamsSchema>,
    @Body() body: z.infer<typeof saveCmsBlockBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminCmsBlockSchema>> {
    return this.content.saveBlock(params.locale, params.key, body, staffActor(auth, request));
  }

  @Get('content/faqs')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminListFaqs',
    summary: 'FAQs, published or not',
    tags: TAGS,
    query: faqListQuerySchema,
    responses: { 200: adminFaqListSchema },
    errors: [403],
  })
  listFaqs(
    @Query() query: z.infer<typeof faqListQuerySchema>,
  ): Promise<z.infer<typeof adminFaqListSchema>> {
    return this.content.listFaqs(query.locale);
  }

  @Post('content/faqs')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminCreateFaq',
    summary: 'Add an FAQ',
    description: SHOWN_WITHIN,
    tags: TAGS,
    body: faqInputSchema,
    responses: { 201: adminFaqSchema },
    errors: [403],
    audit: ['cms.faq_created'],
  })
  createFaq(
    @CurrentAuth() auth: AuthContext,
    @Body() body: z.infer<typeof faqInputSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminFaqSchema>> {
    return this.content.createFaq(body, staffActor(auth, request));
  }

  @Patch('content/faqs/:id')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminUpdateFaq',
    summary: 'Change, reorder or unpublish an FAQ',
    description: SHOWN_WITHIN,
    tags: TAGS,
    params: adminIdParamsSchema,
    body: faqPatchSchema,
    responses: { 200: adminFaqSchema },
    errors: [403, 404],
    audit: ['cms.faq_updated'],
  })
  updateFaq(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: z.infer<typeof faqPatchSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminFaqSchema>> {
    return this.content.updateFaq(id, body, staffActor(auth, request));
  }

  @Get('trust-signals')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminListTrustSignals',
    summary: 'Trust signals with their verification',
    tags: TAGS,
    responses: { 200: adminTrustSignalListSchema },
    errors: [403],
  })
  listTrustSignals(): Promise<z.infer<typeof adminTrustSignalListSchema>> {
    return this.content.listTrustSignals();
  }

  @Patch('trust-signals/:key')
  @AdminRoute('cms:manage')
  @Contract({
    operationId: 'adminUpdateTrustSignal',
    summary: "Change a trust signal's label, value or order",
    description:
      'A changed label or value clears the verification: the claim is hidden until it is verified again.',
    tags: TAGS,
    params: trustSignalParamsSchema,
    body: trustSignalPatchSchema,
    responses: { 200: adminTrustSignalSchema },
    errors: [403, 404],
    audit: ['trust_signal.updated'],
  })
  updateTrustSignal(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Body() body: z.infer<typeof trustSignalPatchSchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminTrustSignalSchema>> {
    return this.content.updateTrustSignal(key, body, staffActor(auth, request));
  }

  @Post('trust-signals/:key/verify')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('trust-signals:verify')
  @Contract({
    operationId: 'adminVerifyTrustSignal',
    summary: 'Verify a trust signal against its evidence',
    description: `Records who verified it and when; the claim then appears on the public site. ${SHOWN_WITHIN}`,
    tags: TAGS,
    params: trustSignalParamsSchema,
    body: verifyTrustSignalBodySchema,
    responses: { 200: adminTrustSignalSchema },
    errors: [403, 404],
    audit: ['trust_signal.verified'],
  })
  verifyTrustSignal(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Body() body: z.infer<typeof verifyTrustSignalBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminTrustSignalSchema>> {
    return this.content.verifyTrustSignal(key, body.evidenceUrl, staffActor(auth, request));
  }

  @Post('trust-signals/:key/unverify')
  @HttpCode(HttpStatus.OK)
  @AdminRoute('trust-signals:verify')
  @Contract({
    operationId: 'adminUnverifyTrustSignal',
    summary: 'Withdraw a verification',
    description: `The claim disappears from the public site. ${SHOWN_WITHIN}`,
    tags: TAGS,
    params: trustSignalParamsSchema,
    body: unverifyTrustSignalBodySchema,
    responses: { 200: adminTrustSignalSchema },
    errors: [403, 404, 409],
    audit: ['trust_signal.unverified'],
  })
  unverifyTrustSignal(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Body() body: z.infer<typeof unverifyTrustSignalBodySchema>,
    @Req() request: Request,
  ): Promise<z.infer<typeof adminTrustSignalSchema>> {
    return this.content.unverifyTrustSignal(key, body.reason, staffActor(auth, request));
  }
}
