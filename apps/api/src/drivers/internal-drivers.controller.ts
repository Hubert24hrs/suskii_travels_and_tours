import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { DriverDocumentsService } from './driver-documents.service';
import { driverScanRunSchema } from './drivers.schemas';

const TAGS = ['Internal'];

/** Worker-only driver document housekeeping (ADR-050): scans whose background run was lost. */
@InternalRoute()
@Controller('internal/drivers')
export class InternalDriversController {
  constructor(private readonly documents: DriverDocumentsService) {}

  @Post('documents/scan-due')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'scanDueDriverDocuments',
    summary: 'Scan driver documents whose background scan did not finish',
    tags: TAGS,
    responses: { 200: driverScanRunSchema },
    errors: [401, 404],
  })
  async scan(): Promise<z.infer<typeof driverScanRunSchema>> {
    return { scanned: await this.documents.scanDue() };
  }
}
