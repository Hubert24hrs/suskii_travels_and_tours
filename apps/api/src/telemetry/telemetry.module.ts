import { Global, Module } from '@nestjs/common';

import { ErrorReporter } from './error-reporter';
import { WebVitalsController } from './web-vitals.controller';

/**
 * Error reporting (ADR-046) and field telemetry from the clients (ADR-044). The OpenTelemetry SDK
 * itself starts in register.ts, before Nest loads.
 */
@Global()
@Module({
  controllers: [WebVitalsController],
  providers: [ErrorReporter],
  exports: [ErrorReporter],
})
export class TelemetryModule {}
