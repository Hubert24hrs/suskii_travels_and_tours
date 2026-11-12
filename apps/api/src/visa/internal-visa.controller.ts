import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { VisaDocumentsService } from './visa-documents.service';
import { pruneRunSchema, scanRunSchema } from './visa.schemas';

const TAGS = ['Internal'];

/** Worker-only visa document housekeeping (ADR-026): scan retries and retention. */
@InternalRoute()
@Controller('internal/visa')
export class InternalVisaController {
  constructor(private readonly documents: VisaDocumentsService) {}

  @Post('scan-due')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'scanDueVisaDocuments',
    summary: 'Scan documents whose background scan did not finish',
    tags: TAGS,
    responses: { 200: scanRunSchema },
    errors: [401, 404],
  })
  scan(): Promise<z.infer<typeof scanRunSchema>> {
    return this.documents.scanDue();
  }

  @Post('prune')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'pruneVisaDocuments',
    summary: 'Delete documents past their retention period',
    tags: TAGS,
    responses: { 200: pruneRunSchema },
    errors: [401, 404],
  })
  async prune(): Promise<z.infer<typeof pruneRunSchema>> {
    return { deleted: await this.documents.prune() };
  }
}
