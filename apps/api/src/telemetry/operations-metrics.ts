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

/**
 * Operational gauges read from the database at each metrics export (once a minute, ADR-047):
 * work in flight, the ticketing backlog and its oldest booking, open refunds and risk reviews,
 * and database connections. Without an exporter the callbacks never run.
 */
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

  private async connections(result: ObservableResult): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ state: string | null; count: bigint }[]>`
      SELECT state, count(*) AS count FROM pg_stat_activity
      WHERE datname = current_database() GROUP BY state`;
    for (const row of rows) result.observe(Number(row.count), { state: row.state ?? 'unknown' });
    const [max] = await this.prisma.$queryRaw<{ max_connections: string }[]>`SHOW max_connections`;
    if (max) result.observe(Number(max.max_connections), { state: 'max' });
  }
}
