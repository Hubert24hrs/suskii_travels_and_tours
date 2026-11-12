import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  BEFORE_DEPARTURE_STATES,
  FINAL_FLIGHT_STATES,
  delayMinutes,
  flightAlert,
  utcToLocal,
  type FlightAlert,
  type FlightState,
} from '@suskii/shared';

import { BackgroundTasks } from '../common/background-tasks';
import { APP_CONFIG, type AppConfig } from '../config/config';
import {
  flightsOf,
  followedNow,
  nextStatusCheck,
  statusQuery,
} from '../flight-status/flight-status';
import { FLIGHT_STATUS } from '../flight-status/flight-status.module';
import type {
  FlightStatusProvider,
  FlightStatusReport,
} from '../flight-status/flight-status.provider';
import type { FlightStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { FlightSegment, FlightSlice } from '../suppliers/supplier.types';
import { flightStatusAlerts, flightStatusChecks } from '../telemetry/metrics';

import { BookingNotifications } from './booking-notifications';
import { itemPayload } from './booking-presenter';
import type { BookingCaller } from './bookings.service';
import { BookingsService } from './bookings.service';
import type { flightStatusSchema } from './bookings.schemas';

type FlightStatusDto = z.infer<typeof flightStatusSchema>;

export interface FlightStatusRun {
  checked: number;
  alerts: number;
  failed: number;
}

type CheckOutcome = 'checked' | 'stopped' | 'failed';

/** A provider that does not answer in this time is tried again at the next check. */
const PROVIDER_TIMEOUT_MS = 10_000;
/** A sweep stops starting new trips after this long; the rest are picked up by the next run. */
const SWEEP_BUDGET_MS = 20_000;
const MINUTE_MS = 60_000;

const UNKNOWN_FLIGHT: FlightStatusReport = {
  state: 'scheduled',
  estimatedDepartureUtc: null,
  estimatedArrivalUtc: null,
  departureTerminal: null,
  departureGate: null,
  arrivalTerminal: null,
  arrivalGate: null,
  baggageBelt: null,
};

const isState = (value: string): value is FlightState =>
  (FINAL_FLIGHT_STATES as readonly string[]).includes(value) ||
  (BEFORE_DEPARTURE_STATES as readonly string[]).includes(value) ||
  value === 'departed';

/** A stored reading belongs to the booked flight only while the flight is the same one. */
const sameFlight = (row: FlightStatus, segment: FlightSegment): boolean =>
  row.carrierCode === segment.marketingCarrier.code &&
  row.flightNumber === segment.flightNumber &&
  row.scheduledDeparture.getTime() === Date.parse(segment.departureUtc);

const finished = (row: FlightStatus | undefined): boolean =>
  row !== undefined && (FINAL_FLIGHT_STATES as readonly string[]).includes(row.state);

/**
 * Live flight status on the day of travel (ADR-095). A ticketed flight is followed from a day
 * before it leaves until it has landed: the sweep reads the provider every few minutes, a
 * traveller looking at the booking reads at most a cached answer, and both go through
 * `refresh()`, which stores the reading and decides, under a lock on the booking item, whether
 * the traveller is told (a delay, a change to it, a cancellation, a diversion, a new gate).
 * Only the airline, the flight number and the day reach the provider.
 */
@Injectable()
export class FlightStatusService {
  private readonly logger = new Logger(FlightStatusService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FLIGHT_STATUS) private readonly provider: FlightStatusProvider | null,
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly notifications: BookingNotifications,
    private readonly background: BackgroundTasks,
  ) {}

  private get settings(): { windowHours: number; checkMinutes: number } {
    return {
      windowHours: this.config.FLIGHT_STATUS_WINDOW_HOURS,
      checkMinutes: this.config.FLIGHT_STATUS_CHECK_MINUTES,
    };
  }

  /** When ticketing should first read a new booking's flights; null while the feature is off. */
  firstCheckAt(slices: readonly FlightSlice[], now = new Date()): Date | null {
    if (!this.provider) return null;
    return nextStatusCheck(flightsOf(slices), new Set(), now, this.settings);
  }

  /**
   * The flights of a booking with what is known of each today. A flight that is not followed
   * yet (or any more) shows its booked times; one that is shows the last reading, refreshed
   * here when it is older than the cache allows.
   */
  async forBooking(
    bookingId: string,
    caller: Pick<BookingCaller, 'client' | 'token'>,
    now = new Date(),
  ): Promise<FlightStatusDto> {
    const booking = await this.bookings.load(bookingId, caller);
    const item = booking.items.find((candidate) => itemPayload(candidate).kind === 'flight');
    const payload = item ? itemPayload(item) : null;
    if (!item || payload?.kind !== 'flight') throw new NotFoundException();
    const segments = flightsOf(payload.offer.slices);
    const live = this.provider !== null && booking.status === 'CONFIRMED';
    let rows = await this.prisma.flightStatus.findMany({ where: { bookingItemId: item.id } });
    if (live && this.stale(segments, rows, now)) {
      await this.refresh(item.id, now);
      rows = await this.prisma.flightStatus.findMany({ where: { bookingItemId: item.id } });
    }
    return {
      live,
      flights: segments.map((segment, flight) => {
        const row = rows.find((candidate) => candidate.flight === flight);
        const known = row && sameFlight(row, segment) ? row : null;
        return {
          flight,
          carrier: segment.marketingCarrier,
          flightNumber: segment.flightNumber,
          origin: segment.origin,
          destination: segment.destination,
          scheduledDepartureLocal: segment.departureLocal,
          scheduledArrivalLocal: segment.arrivalLocal,
          state: known && isState(known.state) ? known.state : 'scheduled',
          estimatedDepartureLocal: known?.estimatedDeparture
            ? utcToLocal(known.estimatedDeparture, segment.origin.timeZone)
            : null,
          estimatedArrivalLocal: known?.estimatedArrival
            ? utcToLocal(known.estimatedArrival, segment.destination.timeZone)
            : null,
          delayMinutes: known?.delayMinutes ?? 0,
          departureTerminal: known?.departureTerminal ?? null,
          departureGate: known?.departureGate ?? null,
          arrivalTerminal: known?.arrivalTerminal ?? null,
          arrivalGate: known?.arrivalGate ?? null,
          baggageBelt: known?.baggageBelt ?? null,
          checkedAt: known?.checkedAt.toISOString() ?? null,
        };
      }),
    };
  }

  /** Trips due a reading, oldest first, within the sweep's time budget. */
  async checkDue(now = new Date()): Promise<FlightStatusRun> {
    const run: FlightStatusRun = { checked: 0, alerts: 0, failed: 0 };
    if (!this.provider) return run;
    const due = await this.prisma.bookingItem.findMany({
      where: { nextStatusCheckAt: { lte: now } },
      select: { id: true },
      orderBy: { nextStatusCheckAt: 'asc' },
      take: this.config.FLIGHT_STATUS_BATCH_SIZE,
    });
    const stopStartingAt = Date.now() + SWEEP_BUDGET_MS;
    for (const { id } of due) {
      if (Date.now() > stopStartingAt) break;
      const result = await this.check(id, now).catch((error: unknown) => {
        this.logger.error({ bookingItemId: id, reason: (error as Error).name }, 'check failed');
        return { outcome: 'failed' as const, alerts: 0 };
      });
      flightStatusChecks.add(1, { outcome: result.outcome });
      if (result.outcome === 'failed') run.failed += 1;
      if (result.outcome === 'checked') run.checked += 1;
      run.alerts += result.alerts;
    }
    return run;
  }

  /** Whether a flight followed now has no reading, or one older than the cache allows. */
  private stale(segments: readonly FlightSegment[], rows: FlightStatus[], now: Date): boolean {
    const oldest = now.getTime() - this.config.FLIGHT_STATUS_CACHE_SECONDS * 1000;
    return segments.some((segment, flight) => {
      if (!followedNow(segment, now, this.config.FLIGHT_STATUS_WINDOW_HOURS)) return false;
      const row = rows.find((candidate) => candidate.flight === flight);
      if (!row || !sameFlight(row, segment)) return true;
      return !finished(row) && row.checkedAt.getTime() < oldest;
    });
  }

  /** One trip of the sweep: read its flights, then book the next reading from what is known. */
  private async check(
    itemId: string,
    now: Date,
  ): Promise<{ outcome: CheckOutcome; alerts: number }> {
    // The next check is booked first, so a trip the provider keeps failing on never blocks others.
    await this.prisma.bookingItem.update({
      where: { id: itemId },
      data: {
        nextStatusCheckAt: new Date(
          now.getTime() + this.config.FLIGHT_STATUS_CHECK_MINUTES * MINUTE_MS,
        ),
      },
    });
    const result = await this.refresh(itemId, now);
    if (result.outcome === 'stopped') {
      await this.prisma.bookingItem.update({
        where: { id: itemId },
        data: { nextStatusCheckAt: null },
      });
      return result;
    }
    const rows = await this.prisma.flightStatus.findMany({ where: { bookingItemId: itemId } });
    const done = new Set(
      result.segments.flatMap((segment, flight) => {
        const row = rows.find((candidate) => candidate.flight === flight);
        return row && sameFlight(row, segment) && finished(row) ? [flight] : [];
      }),
    );
    await this.prisma.bookingItem.update({
      where: { id: itemId },
      data: { nextStatusCheckAt: nextStatusCheck(result.segments, done, now, this.settings) },
    });
    return result;
  }

  /**
   * Reads the provider for the flights of a booking item that are followed now and have not
   * finished, stores each reading and queues the alerts it calls for. `stopped` when the item
   * is not a confirmed flight; `failed` when the provider could not answer (nothing changes).
   */
  private async refresh(
    itemId: string,
    now: Date,
  ): Promise<{ outcome: CheckOutcome; alerts: number; segments: FlightSegment[] }> {
    const provider = this.provider;
    const item = await this.prisma.bookingItem.findUnique({
      where: { id: itemId },
      include: { booking: { select: { id: true, status: true } }, flightStatuses: true },
    });
    const payload = item ? itemPayload(item) : null;
    if (!provider || !item || payload?.kind !== 'flight' || item.booking.status !== 'CONFIRMED') {
      return { outcome: 'stopped', alerts: 0, segments: [] };
    }
    const segments = flightsOf(payload.offer.slices);
    const wanted = segments.flatMap((segment, flight) => {
      if (!followedNow(segment, now, this.config.FLIGHT_STATUS_WINDOW_HOURS)) return [];
      const row = item.flightStatuses.find((candidate) => candidate.flight === flight);
      return row && sameFlight(row, segment) && finished(row) ? [] : [{ flight, segment }];
    });
    if (wanted.length === 0) return { outcome: 'checked', alerts: 0, segments };

    let reports: (FlightStatusReport | null)[];
    try {
      reports = await provider.status(
        wanted.map(({ segment }) => statusQuery(segment)),
        AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      );
    } catch (error) {
      this.logger.warn(
        { bookingItemId: itemId, provider: provider.name, reason: (error as Error).name },
        'Could not read the flight status',
      );
      return { outcome: 'failed', alerts: 0, segments };
    }

    const thresholds = {
      threshold: this.config.FLIGHT_DELAY_ALERT_MINUTES,
      step: this.config.FLIGHT_DELAY_ALERT_STEP_MINUTES,
    };
    // Under a lock on the booking item: the sweep and a traveller's read never both decide to
    // tell the traveller the same thing.
    const alerts = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM booking_items WHERE id = ${itemId}::uuid FOR UPDATE`;
      const stored = await tx.flightStatus.findMany({ where: { bookingItemId: itemId } });
      const raised: { flight: number; alert: FlightAlert }[] = [];
      for (const [index, { flight, segment }] of wanted.entries()) {
        // A flight the provider does not know is stored as scheduled, so it is not asked about
        // again on every read.
        const report = reports[index] ?? UNKNOWN_FLIGHT;
        const row = stored.find((candidate) => candidate.flight === flight);
        const previous = row && sameFlight(row, segment) ? row : null;
        const delay = delayMinutes(segment.departureUtc, report.estimatedDepartureUtc);
        // A provider that still says "scheduled" for a flight it expects to leave late.
        const state: FlightState =
          report.state === 'scheduled' && delay >= thresholds.threshold ? 'delayed' : report.state;
        const alert = flightAlert(
          {
            alertedDelayMinutes: previous?.alertedDelayMinutes ?? null,
            alertedState:
              previous?.alertedState && isState(previous.alertedState)
                ? previous.alertedState
                : null,
            previousGate: previous?.departureGate ?? null,
            state,
            delayMinutes: delay,
            departureGate: report.departureGate,
          },
          thresholds,
        );
        const told = {
          alertedDelayMinutes:
            alert === 'delayed' || alert === 'earlier'
              ? delay
              : alert === 'back_on_time'
                ? null
                : (previous?.alertedDelayMinutes ?? null),
          alertedState:
            alert === 'cancelled' || alert === 'diverted'
              ? state
              : (previous?.alertedState ?? null),
          alertedAt: alert ? now : (previous?.alertedAt ?? null),
        };
        const reading = {
          carrierCode: segment.marketingCarrier.code,
          flightNumber: segment.flightNumber,
          scheduledDeparture: new Date(segment.departureUtc),
          scheduledArrival: new Date(segment.arrivalUtc),
          provider: provider.name,
          state,
          estimatedDeparture: report.estimatedDepartureUtc
            ? new Date(report.estimatedDepartureUtc)
            : null,
          estimatedArrival: report.estimatedArrivalUtc
            ? new Date(report.estimatedArrivalUtc)
            : null,
          delayMinutes: delay,
          departureTerminal: report.departureTerminal,
          departureGate: report.departureGate,
          arrivalTerminal: report.arrivalTerminal,
          arrivalGate: report.arrivalGate,
          baggageBelt: report.baggageBelt,
          checkedAt: now,
          ...told,
        };
        await tx.flightStatus.upsert({
          where: { bookingItemId_flight: { bookingItemId: itemId, flight } },
          create: { bookingItemId: itemId, flight, ...reading },
          update: reading,
        });
        if (alert) raised.push({ flight, alert });
      }
      return raised;
    });

    for (const { flight, alert } of alerts) {
      flightStatusAlerts.add(1, { alert });
      this.background.run('flight-status-alert', () =>
        this.notifications.flightStatus(item.booking.id, flight, alert),
      );
    }
    return { outcome: 'checked', alerts: alerts.length, segments };
  }
}
