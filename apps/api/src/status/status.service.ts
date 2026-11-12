import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { z } from 'zod';

import {
  STATUS_COMPONENTS,
  STATUS_RECENT_DAYS,
  impactState,
  suppliersState,
  worstState,
  type ComponentState,
  type StatusComponent,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { breakerMarkKey } from '../suppliers/breaker-marks';

import type { statusIncidentSchema, statusPageSchema } from './status.schemas';

export type StatusPage = z.infer<typeof statusPageSchema>;
export type PublicIncident = z.infer<typeof statusIncidentSchema>;

/** How long one measurement serves every instance (the edge keeps it as long). */
export const STATUS_CACHE_SECONDS = 30;
/** A paid booking waiting this long for its ticket makes bookings degraded. */
export const TICKETING_DEGRADED_MINUTES = 30;
const SNAPSHOT_KEY = 'status:snapshot';
/** The last incidents read from the database, shown while the database cannot answer. */
const INCIDENTS_KEY = 'status:incidents';
const CHECK_TIMEOUT_MS = 2000;
const INCIDENT_LIMIT = 20;
const DAY_MS = 86_400_000;

export const INCIDENT_WITH_UPDATES = {
  updates: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
} as const satisfies Prisma.StatusIncidentInclude;

type IncidentRow = Prisma.StatusIncidentGetPayload<{ include: typeof INCIDENT_WITH_UPDATES }>;

const isComponent = (value: string): value is StatusComponent =>
  (STATUS_COMPONENTS as readonly string[]).includes(value);

export const presentIncident = (row: IncidentRow): PublicIncident => ({
  id: row.id,
  title: row.title,
  impact: row.impact,
  status: row.status,
  components: row.components.filter(isComponent),
  startedAt: row.startedAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  updates: row.updates.map((update) => ({
    status: update.status,
    message: update.message,
    createdAt: update.createdAt.toISOString(),
  })),
});

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS),
    ),
  ]);

/** What the API measures itself, before incidents are applied. */
export interface Measurements {
  database: boolean;
  redis: boolean;
  /** Breakers marked open per vertical, out of the enabled suppliers. */
  flights: { total: number; failing: number };
  hotels: { total: number; failing: number };
  payments: { total: number; paused: number };
  /** Minutes the oldest booking has waited for ticketing (0 when none or unknown). */
  ticketingWaitMinutes: number;
}

/**
 * Each component's state from measurements alone (ADR-087). Search needs Redis (search state)
 * and is an outage only when both verticals are; bookings, accounts and support need the
 * database; payments are an outage when every provider is paused.
 */
export function measuredStates(m: Measurements): Record<StatusComponent, ComponentState> {
  const flights = suppliersState(m.flights.total, m.flights.failing);
  const hotels = suppliersState(m.hotels.total, m.hotels.failing);
  const search: ComponentState = !m.redis
    ? 'outage'
    : flights === 'outage' && hotels === 'outage'
      ? 'outage'
      : worstState([flights, hotels]) === 'operational'
        ? 'operational'
        : 'degraded';
  const payments: ComponentState =
    m.payments.paused >= m.payments.total
      ? 'outage'
      : m.payments.paused > 0
        ? 'degraded'
        : 'operational';
  return {
    search,
    bookings: !m.database
      ? 'outage'
      : m.ticketingWaitMinutes >= TICKETING_DEGRADED_MINUTES
        ? 'degraded'
        : 'operational',
    payments: m.database ? payments : 'outage',
    accounts: m.database && m.redis ? 'operational' : 'outage',
    support: m.database ? 'operational' : 'outage',
  };
}

/** Measured states made worse by what open incidents declare, plus the overall state. */
export function applyIncidents(
  measured: Record<StatusComponent, ComponentState>,
  incidents: readonly PublicIncident[],
): Pick<StatusPage, 'state' | 'components'> {
  const components = STATUS_COMPONENTS.map((id) => {
    const declared = incidents
      .filter((incident) => incident.resolvedAt === null && incident.components.includes(id))
      .map((incident) => impactState(incident.impact));
    return { id, state: worstState([measured[id], ...declared]) };
  });
  return { state: worstState(components.map((component) => component.state)), components };
}

/**
 * The public status page (ADR-087): one measurement every `STATUS_CACHE_SECONDS`, shared by every
 * instance through Redis. It answers even when Postgres or Redis cannot: the components that
 * need them show an outage, and incidents come from the last good copy.
 */
@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async current(now = new Date()): Promise<StatusPage> {
    const cached = await withTimeout(this.redis.get(SNAPSHOT_KEY)).catch(() => null);
    if (cached) return JSON.parse(cached) as StatusPage;
    const page = await this.measure(now);
    await withTimeout(
      this.redis.set(SNAPSHOT_KEY, JSON.stringify(page), 'EX', STATUS_CACHE_SECONDS),
    ).catch(() => undefined);
    return page;
  }

  /** After an incident changes: the next request measures again (the edge may lag 30 s). */
  async invalidate(): Promise<void> {
    await withTimeout(this.redis.del(SNAPSHOT_KEY)).catch((error: unknown) => {
      this.logger.warn(
        { reason: error instanceof Error ? error.message : 'unknown' },
        'status cache not cleared',
      );
    });
  }

  private async measure(now: Date): Promise<StatusPage> {
    const [database, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`).then(
        () => true,
        () => false,
      ),
      withTimeout(this.redis.ping()).then(
        () => true,
        () => false,
      ),
    ]);
    const [incidents, ticketingWaitMinutes, flightsFailing, hotelsFailing] = await Promise.all([
      this.incidents(database, now),
      database ? this.ticketingWait(now) : Promise.resolve(0),
      redis ? this.failing('flights', this.config.FLIGHT_SUPPLIERS) : Promise.resolve(0),
      redis ? this.failing('hotels', this.config.HOTEL_SUPPLIERS) : Promise.resolve(0),
    ]);
    const measured = measuredStates({
      database,
      redis,
      flights: { total: this.config.FLIGHT_SUPPLIERS.length, failing: flightsFailing },
      hotels: { total: this.config.HOTEL_SUPPLIERS.length, failing: hotelsFailing },
      payments: {
        total: this.config.PAYMENT_PROVIDERS.length,
        paused: this.config.PAYMENT_PROVIDERS_PAUSED.length,
      },
      ticketingWaitMinutes,
    });
    return { ...applyIncidents(measured, incidents), incidents, updatedAt: now.toISOString() };
  }

  /** Open incidents, then those resolved in the last `STATUS_RECENT_DAYS`, newest first. */
  private async incidents(database: boolean, now: Date): Promise<PublicIncident[]> {
    if (database) {
      try {
        const since = new Date(now.getTime() - STATUS_RECENT_DAYS * DAY_MS);
        const [open, recent] = await Promise.all([
          this.prisma.statusIncident.findMany({
            where: { resolvedAt: null },
            include: INCIDENT_WITH_UPDATES,
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            take: INCIDENT_LIMIT,
          }),
          this.prisma.statusIncident.findMany({
            where: { resolvedAt: { gte: since } },
            include: INCIDENT_WITH_UPDATES,
            orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
            take: INCIDENT_LIMIT,
          }),
        ]);
        const incidents = [...open, ...recent].map(presentIncident);
        await withTimeout(this.redis.set(INCIDENTS_KEY, JSON.stringify(incidents))).catch(
          () => undefined,
        );
        return incidents;
      } catch (error) {
        this.logger.warn(
          { reason: error instanceof Error ? error.message : 'unknown' },
          'incidents not read',
        );
      }
    }
    const saved = await withTimeout(this.redis.get(INCIDENTS_KEY)).catch(() => null);
    return saved ? (JSON.parse(saved) as PublicIncident[]) : [];
  }

  private async ticketingWait(now: Date): Promise<number> {
    const oldest = await withTimeout(
      this.prisma.booking.findFirst({
        where: { status: 'TICKETING' },
        orderBy: { updatedAt: 'asc' },
        select: { updatedAt: true },
      }),
    ).catch(() => null);
    return oldest ? Math.max(0, (now.getTime() - oldest.updatedAt.getTime()) / 60_000) : 0;
  }

  private async failing(
    vertical: 'flights' | 'hotels',
    suppliers: readonly string[],
  ): Promise<number> {
    if (suppliers.length === 0) return 0;
    const marks = await withTimeout(
      this.redis.mget(suppliers.map((name) => breakerMarkKey(`${vertical}:${name}`))),
    ).catch(() => [] as (string | null)[]);
    return marks.filter((mark) => mark !== null).length;
  }
}
