import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { bookingCaller } from '../bookings/booking-caller';
import { BOOKING_TOKEN_HEADER } from '../bookings/bookings.schemas';
import { requestContext } from '../common/request-context';
import { Contract, fileResponse } from '../contract/contract';
import { INHOUSE_LIMITS, RateLimit } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';

import { documentTooLarge, documentType, VisaDocumentsService } from './visa-documents.service';
import {
  applicationParamsSchema,
  documentContentQuerySchema,
  documentIdParamsSchema,
  documentLinkSchema,
  eligibilityQuerySchema,
  eligibilitySchema,
  ownerDocumentParamsSchema,
  uploadParamsSchema,
  VISA_DOCUMENT_URL_TYPES,
  visaApplicationSchema,
  visaProductDetailSchema,
  visaProductListQuerySchema,
  visaProductListSchema,
  visaSlugParamsSchema,
} from './visa.schemas';
import { VisaService } from './visa.service';

const TAGS = ['Visa'];

const FILE_NAME_HEADER = {
  name: 'X-File-Name',
  required: false,
  description: 'The original file name, URI-encoded (shown to the traveller and visa officers).',
};

/**
 * The upload's bytes, read here with a hard size limit: no body parser buffers them for us (JSON
 * is the only parsed type), so an oversized upload is refused before it is read in full.
 */
async function readUpload(request: AuthenticatedRequest, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw documentTooLarge(maxBytes);
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(VISA_DOCUMENT_URL_TYPES as readonly string[]).includes(type)) throw documentType();
  if (Buffer.isBuffer(request.body)) {
    if (request.body.byteLength > maxBytes) throw documentTooLarge(maxBytes);
    return request.body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > maxBytes) throw documentTooLarge(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function fileName(request: AuthenticatedRequest): string {
  const raw = request.headers['x-file-name'];
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  try {
    return decodeURIComponent(value).slice(0, 255);
  } catch {
    return '';
  }
}

/**
 * Visa assistance for travellers (ADR-026): eligibility, products, each application's checklist
 * with encrypted uploads, submission, and short-lived signed links to the documents.
 */
@Public()
@Controller()
export class VisaController {
  constructor(
    private readonly visa: VisaService,
    private readonly documents: VisaDocumentsService,
  ) {}

  @Get('visa/eligibility')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'checkVisaEligibility',
    summary: 'Whether a visa is needed, from our visa team’s rules',
    description:
      'Answers `unknown` when there is no rule on file (the page offers to confirm by message); never a guess. Lists the assistance products for the destination and purpose. The issuing government always decides.',
    tags: TAGS,
    query: eligibilityQuerySchema,
    responses: { 200: eligibilitySchema },
  })
  eligibility(
    @Query() query: z.output<typeof eligibilityQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof eligibilitySchema>> {
    return this.visa.eligibility(query, clientContext(request));
  }

  @Get('visa/products')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'listVisaProducts',
    summary: 'Visa assistance products',
    tags: TAGS,
    query: visaProductListQuerySchema,
    responses: { 200: visaProductListSchema },
  })
  async products(
    @Query() query: z.output<typeof visaProductListQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof visaProductListSchema>> {
    return {
      products: await this.visa.products(query.destination, query.currency, clientContext(request)),
    };
  }

  @Get('visa/products/:slug')
  @RateLimit(INHOUSE_LIMITS.catalogIp)
  @Contract({
    operationId: 'getVisaProduct',
    summary: 'A visa assistance product with its document checklist',
    tags: TAGS,
    params: visaSlugParamsSchema,
    query: visaProductListQuerySchema.pick({ currency: true }),
    responses: { 200: visaProductDetailSchema },
    errors: [404],
  })
  product(
    @Param('slug') slug: string,
    @Query() query: { currency: string },
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof visaProductDetailSchema>> {
    return this.visa.product(slug, query.currency, clientContext(request));
  }

  @Get('bookings/:bookingId/visa-applications/:applicationId')
  @Contract({
    operationId: 'getVisaApplication',
    summary: 'A visa application: checklist, uploads and messages',
    tags: TAGS,
    params: applicationParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: visaApplicationSchema },
    errors: [404],
  })
  async application(
    @Param('bookingId') bookingId: string,
    @Param('applicationId') applicationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof visaApplicationSchema>> {
    const application = await this.visa.loadForOwner(
      bookingId,
      applicationId,
      bookingCaller(request),
    );
    return this.visa.ownerView(application);
  }

  @Put('bookings/:bookingId/visa-applications/:applicationId/documents/:checklistKey')
  @HttpCode(HttpStatus.OK)
  @RateLimit(INHOUSE_LIMITS.visaUploadIp)
  @Contract({
    operationId: 'uploadVisaDocument',
    summary: 'Upload the file for one checklist item',
    description:
      'Send the raw file as the body. PDF, JPEG or PNG, detected from the bytes (the declared type and name are ignored); at most VISA_DOCUMENT_MAX_BYTES (413 `document-too-large`, 415 `document-type`). Replaces an earlier upload for the item. The file is encrypted at rest and virus-scanned before it counts (`status: pending_scan`, then `clean`). Only while the application awaits documents or needs action (409 otherwise).',
    tags: TAGS,
    params: uploadParamsSchema,
    headers: [BOOKING_TOKEN_HEADER, FILE_NAME_HEADER],
    upload: {
      contentTypes: VISA_DOCUMENT_URL_TYPES,
      description: 'The file itself.',
    },
    responses: { 200: visaApplicationSchema },
    errors: [404, 409, 413, 415],
  })
  async upload(
    @Param('bookingId') bookingId: string,
    @Param('applicationId') applicationId: string,
    @Param('checklistKey') checklistKey: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof visaApplicationSchema>> {
    const caller = bookingCaller(request);
    // Ownership before reading the body: strangers learn nothing and upload nothing.
    await this.visa.loadForOwner(bookingId, applicationId, caller);
    const bytes = await readUpload(request, this.maxBytes);
    return this.documents.upload(
      { bookingId, applicationId, checklistKey, bytes, fileName: fileName(request) },
      caller,
    );
  }

  private get maxBytes(): number {
    return this.documents.maxBytes;
  }

  @Post('bookings/:bookingId/visa-applications/:applicationId/submit')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'submitVisaApplication',
    summary: 'Send the documents to our visa team',
    description:
      '422 `documents-incomplete` lists the required items without a clean upload; 409 when the application is already with the team.',
    tags: TAGS,
    params: applicationParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: visaApplicationSchema },
    errors: [404, 409, 422],
  })
  submit(
    @Param('bookingId') bookingId: string,
    @Param('applicationId') applicationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof visaApplicationSchema>> {
    return this.visa.submit(bookingId, applicationId, bookingCaller(request));
  }

  @Post('bookings/:bookingId/visa-applications/:applicationId/documents/:documentId/link')
  @HttpCode(HttpStatus.OK)
  @RateLimit(INHOUSE_LIMITS.visaLinkIp)
  @Contract({
    operationId: 'createVisaDocumentLink',
    summary: 'A short-lived link to view one of your documents',
    tags: TAGS,
    params: ownerDocumentParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: documentLinkSchema },
    errors: [404],
  })
  link(
    @Param('bookingId') bookingId: string,
    @Param('applicationId') applicationId: string,
    @Param('documentId') documentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof documentLinkSchema>> {
    return this.documents.ownerLink(
      { bookingId, applicationId, documentId },
      bookingCaller(request),
    );
  }

  @Get('visa/documents/:documentId/content')
  @RateLimit(INHOUSE_LIMITS.visaLinkIp)
  @Contract({
    operationId: 'getVisaDocumentContent',
    summary: 'The bytes behind a signed document link',
    description:
      'Only through a link from `createVisaDocumentLink` or the officer route, before it expires; anything else answers 404. Always an attachment, never rendered inline.',
    tags: TAGS,
    params: documentIdParamsSchema,
    query: documentContentQuerySchema,
    responses: { 200: fileResponse('application/octet-stream') },
    errors: [404],
  })
  async content(
    @Param('documentId') documentId: string,
    @Query() query: z.output<typeof documentContentQuerySchema>,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.content(documentId, query, requestContext(request));
    // Never let a browser render or run it: attachment, no sniffing, sandboxed if opened anyway.
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      length: file.bytes.byteLength,
    });
  }
}
