import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  addDays,
  alertEndsOn,
  localDate,
  MAX_ADVANCE_DAYS,
  MAX_PRICE_ALERTS,
  money,
  shouldNotifyPrice,
  toWire,
  type PriceAlertInput,
} from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { PriceAlert } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { priceAlertMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';
import { PricingService } from '../pricing/pricing.service';
import { withCurrentTier } from '../prime/prime-status';
import { flightPricingContext, FlightSearchService } from '../search/flight-search.service';

import type { PriceAlertDto } from './alerts.schemas';

const HOUR_MS = 3_600_000;
/** Dates sampled for a month alert: at most this many searches per alert and run. */
const MONTH_SAMPLES = 4;

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const alertError = (status: HttpStatus, slug: string, title: string, detail: string) =>
  new ProblemDetailsException(status, slug, title, detail);

export function toPriceAlertDto(alert: PriceAlert): PriceAlertDto {
  return {
    id: alert.id,
    origin: alert.origin,
    destination: alert.destination,
    departureDate: alert.departureDate ? isoDate(alert.departureDate) : null,
    departureMonth: alert.departureMonth,
    cabinClass: alert.cabinClass,
    currency: alert.currency,
    target: alert.targetMinor !== null ? toWire(money(alert.targetMinor, alert.currency)) : null,
    lastPrice:
      alert.lastPriceMinor !== null ? toWire(money(alert.lastPriceMinor, alert.currency)) : null,
    lastCheckedAt: alert.lastCheckedAt?.toISOString() ?? null,
    lastNotifiedAt: alert.lastNotifiedAt?.toISOString() ?? null,
    active: alert.active,
    endsOn: isoDate(alert.endsOn),
    createdAt: alert.createdAt.toISOString(),
  };
}

/**
 * The departure dates a run searches for an alert: its date, or up to four dates a week apart
 * in its month (from tomorrow when the month has started), within the booking window.
 */
export function alertDates(
  alert: { departureDate: string | null; departureMonth: string | null },
  today: string,
): string[] {
  const last = addDays(today, MAX_ADVANCE_DAYS);
  if (alert.departureDate) {
    return alert.departureDate > today && alert.departureDate <= last ? [alert.departureDate] : [];
  }
  const month = alert.departureMonth ?? '';
  const end = alertEndsOn({ departureMonth: month });
  const tomorrow = addDays(today, 1);
  let date = `${month}-01` > tomorrow ? `${month}-01` : tomorrow;
  const dates: string[] = [];
  while (date <= end && date <= last && dates.length < MONTH_SAMPLES) {
    dates.push(date);
    date = addDays(date, 7);
  }
  return dates;
}

/**
 * Price alerts (ADR-032): signed-in travellers watch a route for a date or a month; the worker
 * runs `run()` every few minutes and each alert is checked at most every
 * PRICE_ALERT_INTERVAL_HOURS. Searches go through the cached search orchestrator, so alerts on the
 * same route and date share supplier calls, and prices are the owner's (Prime included).
 */
@Injectable()
export class PriceAlertsService {
  private readonly logger = new Logger(PriceAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly flights: FlightSearchService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationService,
  ) {}

  async list(userId: string): Promise<PriceAlertDto[]> {
    const alerts = await this.prisma.priceAlert.findMany({
      where: { userId },
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    });
    return alerts.map(toPriceAlertDto);
  }

  async create(userId: string, input: PriceAlertInput, now = new Date()): Promise<PriceAlertDto> {
    const today = localDate(now, 'UTC');
    const endsOn = alertEndsOn(input);
    const startsBy = input.departureDate ?? endsOn;
    if (
      startsBy <= today ||
      (input.departureDate ?? `${input.departureMonth}-01`) > addDays(today, MAX_ADVANCE_DAYS)
    ) {
      throw alertError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-alert-dates',
        'Choose a future date',
        `Alerts watch departures from tomorrow up to ${MAX_ADVANCE_DAYS} days ahead.`,
      );
    }
    const alert = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const active = await tx.priceAlert.findMany({ where: { userId, active: true } });
      const duplicate = active.find(
        (row) =>
          row.origin === input.origin &&
          row.destination === input.destination &&
          (row.departureDate ? isoDate(row.departureDate) : null) === input.departureDate &&
          row.departureMonth === input.departureMonth &&
          row.cabinClass === input.cabinClass &&
          row.currency === input.currency,
      );
      if (duplicate) {
        throw alertError(
          HttpStatus.CONFLICT,
          'price-alert-exists',
          'You already watch this route',
          'Change or delete the existing alert instead.',
        );
      }
      if (active.length >= MAX_PRICE_ALERTS) {
        throw alertError(
          HttpStatus.CONFLICT,
          'price-alert-limit',
          'Too many price alerts',
          `Up to ${MAX_PRICE_ALERTS} alerts can be active; delete one first.`,
        );
      }
      return tx.priceAlert.create({
        data: {
          userId,
          origin: input.origin,
          destination: input.destination,
          departureDate: input.departureDate ? dateOnly(input.departureDate) : null,
          departureMonth: input.departureMonth,
          cabinClass: input.cabinClass,
          currency: input.currency,
          targetMinor: input.targetMinor !== null ? BigInt(input.targetMinor) : null,
          endsOn: dateOnly(endsOn),
        },
      });
    });
    return toPriceAlertDto(alert);
  }

  async remove(userId: string, alertId: string): Promise<void> {
    const { count } = await this.prisma.priceAlert.deleteMany({ where: { id: alertId, userId } });
    if (count === 0) throw new NotFoundException();
  }

  async run(now = new Date()): Promise<{
    checked: number;
    notified: number;
    retired: number;
    failed: number;
  }> {
    const today = localDate(now, 'UTC');
    const { count: retired } = await this.prisma.priceAlert.updateMany({
      where: { active: true, endsOn: { lte: dateOnly(today) } },
      data: { active: false },
    });
    const due = await this.prisma.priceAlert.findMany({
      where: {
        active: true,
        OR: [
          { lastCheckedAt: null },
          {
            lastCheckedAt: {
              lt: new Date(now.getTime() - this.config.PRICE_ALERT_INTERVAL_HOURS * HOUR_MS),
            },
          },
        ],
      },
      orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: this.config.PRICE_ALERT_BATCH_SIZE,
    });
    let notified = 0;
    let failed = 0;
    for (const alert of due) {
      try {
        if (await this.check(alert, today, now)) notified += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn({ reason: (error as Error).name }, 'price alert check failed');
        // Try again next interval rather than on every run.
        await this.prisma.priceAlert.update({
          where: { id: alert.id },
          data: { lastCheckedAt: now },
        });
      }
    }
    return { checked: due.length, notified, retired, failed };
  }

  /** Prices the alert's route for its owner; returns whether a notice went out. */
  private async check(alert: PriceAlert, today: string, now: Date): Promise<boolean> {
    const dates = alertDates(
      {
        departureDate: alert.departureDate ? isoDate(alert.departureDate) : null,
        departureMonth: alert.departureMonth,
      },
      today,
    );
    const [pricer, client] = await Promise.all([
      this.pricing.pricer('flights', alert.currency),
      withCurrentTier(this.prisma, {
        channel: null,
        userTier: 'member',
        userId: alert.userId,
        benefits: null,
      }),
    ]);
    let best: { minor: bigint; date: string } | null = null;
    for (const date of dates) {
      const offer = await this.flights.cheapestOffer({
        slices: [{ origin: alert.origin, destination: alert.destination, departureDate: date }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: alert.cabinClass,
        directOnly: false,
      });
      if (!offer) continue;
      const { breakdown } = pricer(offer.price, flightPricingContext(offer, client, now));
      if (!best || breakdown.total.minor < best.minor) {
        best = { minor: breakdown.total.minor, date };
      }
    }
    if (!best) {
      await this.prisma.priceAlert.update({
        where: { id: alert.id },
        data: { lastCheckedAt: now },
      });
      return false;
    }
    const notify = shouldNotifyPrice({
      priceMinor: best.minor,
      targetMinor: alert.targetMinor,
      lastNotifiedMinor: alert.lastNotifiedMinor,
      lastNotifiedAt: alert.lastNotifiedAt,
      minDropBps: this.config.PRICE_ALERT_MIN_DROP_BPS,
      now,
    });
    if (notify) {
      const query = new URLSearchParams({
        trip: 'one_way',
        from: alert.origin,
        to: alert.destination,
        depart: best.date,
        adults: '1',
        ...(alert.cabinClass !== 'economy' ? { cabin: alert.cabinClass } : {}),
      });
      await this.notifications.notify(
        alert.userId,
        priceAlertMessage({
          origin: alert.origin,
          destination: alert.destination,
          when: alert.departureMonth ?? best.date,
          price: money(best.minor, alert.currency),
          atTarget: alert.targetMinor !== null && best.minor <= alert.targetMinor,
          searchUrl: `${this.config.WEB_APP_URL}/flights/search?${query.toString()}`,
        }),
      );
    }
    await this.prisma.priceAlert.update({
      where: { id: alert.id },
      data: {
        lastPriceMinor: best.minor,
        lastCheckedAt: now,
        ...(notify
          ? { lastNotifiedMinor: best.minor, lastNotifiedAt: now }
          : // The first price seen is the baseline later drops are measured from.
            alert.lastNotifiedMinor === null
            ? { lastNotifiedMinor: best.minor }
            : {}),
      },
    });
    return notify;
  }
}
