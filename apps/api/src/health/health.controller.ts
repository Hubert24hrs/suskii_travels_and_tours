import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Response } from 'express';
import { Redis } from 'ioredis';

import { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract, named } from '../contract/contract';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';

const healthStatusSchema = named('HealthStatus', z.object({ status: z.literal('ok') }));
const dependencyStatus = z.enum(['up', 'down']);
const readinessStatusSchema = named(
  'ReadinessStatus',
  z.object({
    status: z.enum(['ok', 'unavailable']),
    checks: z.object({ database: dependencyStatus, redis: dependencyStatus }),
  }),
);

export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type ReadinessStatus = z.infer<typeof readinessStatusSchema>;

const CHECK_TIMEOUT_MS = 2000;

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS),
    ),
  ]);

/**
 * Infra probes, version-neutral so orchestrator config never changes with API versions.
 * `/health`: the process is alive. `/ready`: it can serve traffic (Postgres and Redis reachable).
 */
@Public()
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'getHealth',
    summary: 'Liveness probe',
    tags: ['Health'],
    responses: { 200: healthStatusSchema },
  })
  check(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  @Contract({
    operationId: 'getReadiness',
    summary: 'Readiness probe (Postgres and Redis reachable)',
    tags: ['Health'],
    responses: { 200: readinessStatusSchema, 503: readinessStatusSchema },
  })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessStatus> {
    const [database, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      withTimeout(this.redis.ping()).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);
    const healthy = database === 'up' && redis === 'up';
    response.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'unavailable', checks: { database, redis } };
  }
}
