import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
}

/**
 * Liveness probe for load balancers and orchestrators. Version-neutral so infra
 * config never changes when the public API moves to a new version.
 * Readiness (database, Redis) is added with those dependencies in phase 2.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
