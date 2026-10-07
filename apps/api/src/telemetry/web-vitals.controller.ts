import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { RateLimit, TELEMETRY_LIMITS } from '../rate-limit/rate-limit.decorator';

import { webVitals } from './metrics';
import { webVitalsReportSchema } from './web-vitals.schemas';

/**
 * Field performance from the website (ADR-044). Values go straight into OpenTelemetry histograms;
 * nothing is stored and nothing identifies the visitor (no account, IP address or URL).
 */
@Public()
@Controller('telemetry')
export class WebVitalsController {
  @Post('web-vitals')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(TELEMETRY_LIMITS.webVitalsIp)
  @Contract({
    operationId: 'reportWebVitals',
    summary: 'Report Core Web Vitals from a page view',
    description:
      'Sent by the website with `navigator.sendBeacon` when the page is hidden, so it also accepts the JSON as `text/plain`. Recorded as histograms by page template and device class.',
    tags: ['Telemetry'],
    body: webVitalsReportSchema,
    beacon: true,
    responses: { 204: null },
    errors: [413],
  })
  report(@Body() body: z.infer<typeof webVitalsReportSchema>): void {
    const attributes = { page: body.page, device: body.device };
    for (const metric of body.metrics) webVitals[metric.name].record(metric.value, attributes);
  }
}
