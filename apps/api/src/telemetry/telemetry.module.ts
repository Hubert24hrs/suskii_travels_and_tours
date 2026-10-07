import { Module } from '@nestjs/common';

import { WebVitalsController } from './web-vitals.controller';

/** Field telemetry from the clients (ADR-044). The OpenTelemetry SDK itself starts in register.ts. */
@Module({ controllers: [WebVitalsController] })
export class TelemetryModule {}
