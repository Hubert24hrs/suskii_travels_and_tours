import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { metrics, type ObservableResult } from '@opentelemetry/api';

import { PrismaService } from '../infra/prisma.service';

/** Bookings whose status means work is still due (payment, ticketing, a plan, a refund). */
const IN_FLIGHT = [
  'AWAITING_PAYMENT',
  'HELD',
  'PARTIALLY_PAID',
  'PAID',
  'TICKETING',
  'REFUND_PENDING',
] as const;
const OPEN_REFUNDS = ['pending_approval', 'approved', 'processing', 'needs_review'] as const;
const LIVE_RIDES = ['searching', 'assigned', 'arrived', 'in_progress'] as const;
const OPEN_INCIDENTS = ['open', 'acknowledged'] as const;
/** A departure this long past its time with sold seats and nobody boarded points at the scanner. */
const UNSCANNED_AFTER_MS = 30 * 60_000;
const UNSCANNED_WINDOW_MS = 6 * 60 * 60_000;

/**
 * Operational gauges read from the database at each metrics export (once a minute, ADR-047):
 * work in flight, the ticketing backlog and its oldest booking, open refunds and risk reviews,
 * database connections, and for Cars: live rides and the oldest search and trip, open safety
 * incidents, driver documents waiting for review and departures nobody was scanned onto.
 * Without an exporter the callbacks never run.
 */
const ageSeconds = (since: Date | null): number =>
  since ? Math.max(0, (Date.now() - since.getTime()) / 1000) : 0;

@Injectable()
export class OperationsMetrics implements OnModuleInit {
  private readonly logger = new Logger(OperationsMetrics.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const meter = metrics.getMeter('suskii-api');
    meter
      .createObservableGauge('suskii.bookings.in_flight', {
        description: 'Bookings with work still due, by status',
      })
      .addCallback((result) => this.observe('bookings', () => this.bookings(result)));
    meter
      .createObservableGauge('suskii.ticketing.oldest_age', {
        unit: 's',
        description: 'Age of the oldest booking waiting for ticketing (0 when none)',
      })
      .addCallback((result) => this.observe('ticketing', () => this.ticketingAge(result)));
    meter
      .createObservableGauge('suskii.refunds.open', {
        description: 'Refunds not yet settled, by status',
      })
      .addCallback((result) => this.observe('refunds', () => this.refunds(result)));
    meter
      .createObservableGauge('suskii.payment_risk_reviews.open', {
        description: 'Captured payments held for a finance review (ADR-040)',
      })
      .addCallback((result) => this.observe('risk reviews', () => this.riskReviews(result)));
    meter
      .createObservableGauge('suskii.rides.live', {
        description: 'Rides searching for or with a driver, by status',
      })
      .addCallback((result) => this.observe('rides', () => this.liveRides(result)));
    meter
      .createObservableGauge('suskii.rides.oldest_search_age', {
        unit: 's',
        description: 'Age of the oldest ride still searching for a driver (0 when none)',
      })
      .addCallback((result) => this.observe('ride search', () => this.oldestSearch(result)));
    meter
      .createObservableGauge('suskii.rides.longest_trip_age', {
        unit: 's',
        description: 'Time since the oldest ride in progress started (0 when none)',
      })
      .addCallback((result) => this.observe('ride trip', () => this.longestTrip(result)));
    meter
      .createObservableGauge('suskii.safety_incidents.open', {
        description: 'Safety incidents not yet resolved, by status and kind',
      })
      .addCallback((result) => this.observe('incidents', () => this.incidents(result)));
    meter
      .createObservableGauge('suskii.driver_documents.awaiting_review', {
        description: 'Scanned driver documents waiting for a reviewer',
      })
      .addCallback((result) => this.observe('driver documents', () => this.documents(result)));
    meter
      .createObservableGauge('suskii.driver_documents.oldest_age', {
        unit: 's',
        description: 'Age of the oldest driver document waiting for review (0 when none)',
      })
      .addCallback((result) => this.observe('driver document age', () => this.documentAge(result)));
    meter
      .createObservableGauge('suskii.bus.trips_unscanned', {
        description: 'Departures over 30 minutes past their time with sold seats and none boarded',
      })
      .addCallback((result) => this.observe('bus scans', () => this.unscannedTrips(result)));
    meter
      .createObservableGauge('suskii.db.connections', {
        description: 'Connections to the application database by state, and the server maximum',
      })
      .addCallback((result) => this.observe('database', () => this.connections(result)));
  }

  /** A failed reading skips one export; it must never break the exporter. */
  private async observe(name: string, read: () => Promise<void>): Promise<void> {
    try {
      await read();
    } catch (error) {
      this.logger.warn({ gauge: name, reason: (error as Error).name }, 'metrics reading failed');
    }
  }

  private async bookings(result: ObservableResult): Promise<void> {
    const rows = await this.prisma.booking.groupBy({
      by: ['status'],
      where: { status: { in: [...IN_FLIGHT] } },
      _count: { _all: true },
    });
    for (const status of IN_FLIGHT) {
      const row = rows.find((candidate) => candidate.status === status);
      result.observe(row?._count._all ?? 0, { status });
    }
  }

  private async ticketingAge(result: ObservableResult): Promise<void> {
    const oldest = await this.prisma.booking.findFirst({
      where: { status: 'TICKETING' },
      orderBy: { updatedAt: 'asc' },
      select: { updatedAt: true },
    });
    result.observe(oldest ? Math.max(0, (Date.now() - oldest.updatedAt.getTime()) / 1000) : 0);
  }

  private async refunds(result: ObservableResult): Promise<void> {
    const rows = await this.prisma.refund.groupBy({
      by: ['status'],
      where: { status: { in: [...OPEN_REFUNDS] } },
      _count: { _all: true },
    });
    for (const status of OPEN_REFUNDS) {
      const row = rows.find((candidate) => candidate.status === status);
      result.observe(row?._count._all ?? 0, { status });
    }
  }

  private async riskReviews(result: ObservableResult): Promise<void> {
    result.observe(await this.prisma.paymentRiskReview.count({ where: { status: 'open' } }));
  }

  private async liveRides(result: ObservableResult): Promise<void> {
    const rows = await this.prisma.ride.groupBy({
      by: ['status'],
      where: { status: { in: [...LIVE_RIDES] } },
      _count: { _all: true },
    });
    for (const status of LIVE_RIDES) {
      const row = rows.find((candidate) => candidate.status === status);
      result.observe(row?._count._all ?? 0, { status });
    }
  }

  private async oldestSearch(result: ObservableResult): Promise<void> {
    const oldest = await this.prisma.ride.findFirst({
      where: { status: 'searching', searchStartedAt: { not: null } },
      orderBy: { searchStartedAt: 'asc' },
      select: { searchStartedAt: true },
    });
    result.observe(ageSeconds(oldest?.searchStartedAt ?? null));
  }

  private async longestTrip(result: ObservableResult): Promise<void> {
    const oldest = await this.prisma.ride.findFirst({
      where: { status: 'in_progress', startedAt: { not: null } },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true },
    });
    result.observe(ageSeconds(oldest?.startedAt ?? null));
  }

  private async incidents(result: ObservableResult): Promise<void> {
    const rows = await this.prisma.safetyIncident.groupBy({
      by: ['status', 'kind'],
      where: { status: { in: [...OPEN_INCIDENTS] } },
      _count: { _all: true },
    });
    // Always report the open SOS series, so an alert on it resolves to 0 rather than vanishing.
    if (!rows.some((row) => row.status === 'open' && row.kind === 'sos')) {
      result.observe(0, { status: 'open', kind: 'sos' });
    }
    for (const row of rows) {
      result.observe(row._count._all, { status: row.status, kind: row.kind });
    }
  }

  private async documents(result: ObservableResult): Promise<void> {
    result.observe(await this.prisma.driverDocument.count({ where: { status: 'clean' } }));
  }

  private async documentAge(result: ObservableResult): Promise<void> {
    const oldest = await this.prisma.driverDocument.findFirst({
      where: { status: 'clean' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    result.observe(ageSeconds(oldest?.createdAt ?? null));
  }

  private async unscannedTrips(result: ObservableResult): Promise<void> {
    const now = Date.now();
    const count = await this.prisma.busTrip.count({
      where: {
        status: { in: ['scheduled', 'boarding', 'departed'] },
        departsAt: {
          lte: new Date(now - UNSCANNED_AFTER_MS),
          gte: new Date(now - UNSCANNED_WINDOW_MS),
        },
        tickets: { some: { status: 'valid' }, none: { status: 'boarded' } },
      },
    });
    result.observe(count);
  }

  private async connections(result: ObservableResult): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ state: string | null; count: bigint }[]>`
      SELECT state, count(*) AS count FROM pg_stat_activity
      WHERE datname = current_database() GROUP BY state`;
    for (const row of rows) result.observe(Number(row.count), { state: row.state ?? 'unknown' });
    const [max] = await this.prisma.$queryRaw<{ max_connections: string }[]>`SHOW max_connections`;
    if (max) result.observe(Number(max.max_connections), { state: 'max' });
  }
}
