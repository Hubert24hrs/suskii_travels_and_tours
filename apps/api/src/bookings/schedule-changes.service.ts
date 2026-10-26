import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import { toJsonValue } from '../common/json';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Prisma, ScheduleChangeStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { supplierUnavailable } from '../search/search.errors';
import { SupplierRunner } from '../search/supplier-runner';
import { OfferUnavailableError, SupplierRequestError } from '../suppliers/supplier.errors';
import { FLIGHT_SUPPLIERS } from '../suppliers/suppliers.module';
import type { FlightSlice, FlightSupplier, OrderChanges } from '../suppliers/supplier.types';
import { scheduleChangeChecks } from '../telemetry/metrics';

import { BookingDocumentsService } from './booking-documents.service';
import { BookingNotifications } from './booking-notifications';
import { itemPayload } from './booking-presenter';
import type { FlightItemPayload } from './booking-pricing';
import { bookingConflict } from './booking.errors';
import type { BookingDto } from './bookings.schemas';
import { BookingsService, customerActor, type BookingCaller } from './bookings.service';
import { departed, itinerarySignature } from './schedule-changes';

const HOUR_MS = 3_600_000;
/** A sweep starts no new check after this long; the rest wait for the next sweep a minute later. */
const SWEEP_BUDGET_MS = 20_000;
/** Covers the supplier's acceptance; a second accept waits for the first to finish. */
const LOCK_MS = 2 * 60_000;
const LOCK_PREFIX = 'booking:schedule-change-lock:';

export type ScheduleCheckOutcome = 'checked' | 'stopped' | 'failed';

export interface ScheduleChangeRun {
  checked: number;
  detected: number;
  resolved: number;
  failed: number;
}

export const scheduleChangeNotFound = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.NOT_FOUND,
    'schedule-change-not-found',
    'Schedule change not found',
  );

export const scheduleChangeNotAcceptable = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'schedule-change-not-acceptable',
    'This change cannot be accepted online',
    'Contact support about the new flight times.',
  );

/** Who resolved a change through us: the traveller accepting it online. */
interface Acceptance {
  changeId: string;
  caller: BookingCaller;
}

interface SyncResult {
  /** Changes seen for the first time (ids of our rows). */
  detected: string[];
  /** Open changes the supplier now says were resolved elsewhere. */
  resolved: { id: string; status: ScheduleChangeStatus }[];
  /** Open changes that can no longer be accepted online: support takes over. */
  unacceptable: string[];
  itineraryUpdated: boolean;
}

/**
 * Airline schedule changes on ticketed flights (ADR-065). The worker's sweep asks each ticketed
 * flight's supplier for changes every SCHEDULE_CHANGE_CHECK_HOURS until the trip has left; a new
 * change is stored, the traveller told by email and push, and support alerted when it cannot be
 * accepted online. The traveller accepts it from the booking page or the app; cancelling instead
 * goes through online cancellation (ADR-064) or support. The booking's itinerary follows the
 * airline's once no change is waiting for the traveller.
 */
@Injectable()
export class ScheduleChangesService {
  private readonly logger = new Logger(ScheduleChangesService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FLIGHT_SUPPLIERS) private readonly suppliers: FlightSupplier[],
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly runner: SupplierRunner,
    private readonly bookings: BookingsService,
    private readonly notifications: BookingNotifications,
    private readonly documents: BookingDocumentsService,
    private readonly audit: AuditService,
    private readonly background: BackgroundTasks,
  ) {}

  /** When ticketing should first check a new order: only for suppliers that report changes. */
  firstCheckAt(supplierName: string, now = new Date()): Date | null {
    const supplier = this.suppliers.find((candidate) => candidate.name === supplierName);
    return supplier?.tracksChanges ? this.nextCheck(now) : null;
  }

  /** Flights due for a check, oldest first, within the sweep's time budget. */
  async checkDue(now = new Date()): Promise<ScheduleChangeRun> {
    const due = await this.prisma.bookingItem.findMany({
      where: { nextChangeCheckAt: { lte: now } },
      select: { id: true },
      orderBy: { nextChangeCheckAt: 'asc' },
      take: this.config.SCHEDULE_CHANGE_BATCH_SIZE,
    });
    const run: ScheduleChangeRun = { checked: 0, detected: 0, resolved: 0, failed: 0 };
    const stopStartingAt = Date.now() + SWEEP_BUDGET_MS;
    for (const { id } of due) {
      if (Date.now() > stopStartingAt) break;
      const result = await this.check(id, now).catch((error: unknown) => {
        this.logger.error({ bookingItemId: id, reason: (error as Error).name }, 'check failed');
        return { outcome: 'failed' as const, sync: null };
      });
      scheduleChangeChecks.add(1, { outcome: result.outcome });
      if (result.outcome === 'failed') run.failed += 1;
      if (result.outcome !== 'checked') continue;
      run.checked += 1;
      run.detected += result.sync?.detected.length ?? 0;
      run.resolved += result.sync?.resolved.length ?? 0;
    }
    return run;
  }

  /**
   * The traveller accepts a change shown on their booking. The supplier accepts first; the
   * change is then resolved and the booking shows the new flights. Safe to repeat.
   */
  async accept(bookingId: string, changeId: string, caller: BookingCaller): Promise<BookingDto> {
    const booking = await this.bookings.load(bookingId, caller);
    const change = await this.prisma.flightScheduleChange.findFirst({
      where: { id: changeId, bookingId: booking.id },
    });
    if (!change) throw scheduleChangeNotFound();
    if (change.status === 'accepted') return this.bookings.present(booking);
    const item = booking.items.find((candidate) => candidate.id === change.bookingItemId);
    const payload = item ? itemPayload(item) : null;
    const supplier = this.suppliers.find(
      (candidate) => candidate.name === change.supplier && candidate.tracksChanges,
    );
    if (
      change.status !== 'open' ||
      !change.acceptable ||
      booking.status !== 'CONFIRMED' ||
      !item?.supplierOrderId ||
      payload?.kind !== 'flight' ||
      !supplier
    ) {
      throw scheduleChangeNotAcceptable();
    }
    const lock = LOCK_PREFIX + booking.id;
    if ((await this.redis.set(lock, '1', 'PX', LOCK_MS, 'NX')) !== 'OK') throw bookingConflict();
    try {
      const orderId = item.supplierOrderId;
      let result: OrderChanges;
      try {
        result = await this.runner.call('flights', supplier.name, 'accept-change', (signal) =>
          supplier.acceptAirlineChange(
            { orderId, offer: payload.offer, changeId: change.supplierChangeId },
            signal,
          ),
        );
      } catch (error) {
        if (error instanceof OfferUnavailableError || error instanceof SupplierRequestError) {
          throw scheduleChangeNotAcceptable();
        }
        throw supplierUnavailable();
      }
      // The supplier took the acceptance: record it even if its answer lags behind.
      const changes = result.changes.map((candidate) =>
        candidate.id === change.supplierChangeId
          ? { ...candidate, actionTaken: 'accepted' as const }
          : candidate,
      );
      const sync = await this.sync(item.id, supplier.name, { ...result, changes }, new Date(), {
        changeId: change.id,
        caller,
      });
      this.afterSync(sync);
    } finally {
      await this.redis.del(lock);
    }
    return this.bookings.present(await this.bookings.reload(booking.id));
  }

  private nextCheck(now: Date): Date {
    return new Date(now.getTime() + this.config.SCHEDULE_CHANGE_CHECK_HOURS * HOUR_MS);
  }

  private async check(
    itemId: string,
    now: Date,
  ): Promise<{ outcome: ScheduleCheckOutcome; sync: SyncResult | null }> {
    const item = await this.prisma.bookingItem.findUnique({
      where: { id: itemId },
      include: { booking: { select: { status: true } } },
    });
    if (!item) return { outcome: 'stopped', sync: null };
    const payload = itemPayload(item);
    const supplier = this.suppliers.find(
      (candidate) => candidate.name === item.supplier && candidate.tracksChanges,
    );
    if (
      payload.kind !== 'flight' ||
      !supplier ||
      !item.supplierOrderId ||
      item.booking.status !== 'CONFIRMED' ||
      departed(payload.offer.slices, now)
    ) {
      await this.prisma.bookingItem.update({
        where: { id: itemId },
        data: { nextChangeCheckAt: null },
      });
      return { outcome: 'stopped', sync: null };
    }
    // The next check is booked first, so an order the supplier keeps failing never blocks others.
    await this.prisma.bookingItem.update({
      where: { id: itemId },
      data: { nextChangeCheckAt: this.nextCheck(now) },
    });
    const orderId = item.supplierOrderId;
    let result: OrderChanges;
    try {
      result = await this.runner.call('flights', supplier.name, 'order-changes', (signal) =>
        supplier.orderChanges({ orderId, offer: payload.offer }, signal),
      );
    } catch (error) {
      this.logger.warn(
        { bookingItemId: itemId, supplier: supplier.name, reason: (error as Error).name },
        'Could not check the order for airline changes',
      );
      return { outcome: 'failed', sync: null };
    }
    const sync = await this.sync(itemId, supplier.name, result, now, null);
    this.afterSync(sync);
    return { outcome: 'checked', sync };
  }

  /**
   * Mirrors the supplier's changes into ours, under a row lock on the booking item so a sweep and
   * an acceptance never interleave. New changes are stored; open ones the supplier resolved are
   * closed; and once nothing is waiting for the traveller, the itinerary follows the airline's.
   */
  private sync(
    itemId: string,
    supplier: string,
    result: OrderChanges,
    now: Date,
    acceptance: Acceptance | null,
  ): Promise<SyncResult & { bookingId: string; reference: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM booking_items WHERE id = ${itemId}::uuid FOR UPDATE`;
      const item = await tx.bookingItem.findUniqueOrThrow({
        where: { id: itemId },
        include: { booking: { select: { id: true, reference: true } } },
      });
      const bookingId = item.booking.id;
      const outcome: SyncResult = {
        detected: [],
        resolved: [],
        unacceptable: [],
        itineraryUpdated: false,
      };
      let open = 0;
      for (const change of result.changes) {
        const status: ScheduleChangeStatus = change.actionTaken ?? 'open';
        const existing = await tx.flightScheduleChange.findUnique({
          where: { supplier_supplierChangeId: { supplier, supplierChangeId: change.id } },
        });
        if (existing && existing.bookingItemId !== itemId) continue;
        if (!existing) {
          const created = await tx.flightScheduleChange.create({
            data: {
              bookingId,
              bookingItemId: itemId,
              supplier,
              supplierChangeId: change.id,
              removed: toJsonValue(change.removed) as Prisma.InputJsonValue,
              added: toJsonValue(change.added) as Prisma.InputJsonValue,
              acceptable: change.acceptable,
              status,
              changedAt: new Date(change.createdAt),
              resolvedAt: status === 'open' ? null : now,
            },
          });
          await this.audit.record(
            {
              action: 'booking.schedule_change_detected',
              actorType: 'system',
              targetType: 'booking',
              targetId: bookingId,
              metadata: {
                scheduleChangeId: created.id,
                supplier,
                status,
                acceptable: change.acceptable,
              },
            },
            tx,
          );
          outcome.detected.push(created.id);
        } else if (existing.status === 'open' && status !== 'open') {
          await tx.flightScheduleChange.update({
            where: { id: existing.id },
            data: { status, resolvedAt: now },
          });
          const byTraveller = acceptance?.changeId === existing.id && status === 'accepted';
          await this.audit.record(
            {
              action: byTraveller
                ? 'booking.schedule_change_accepted'
                : 'booking.schedule_change_resolved',
              ...(byTraveller
                ? {
                    actorUserId: customerActor(acceptance.caller).userId ?? null,
                    context: acceptance.caller.context,
                  }
                : { actorType: 'system' as const }),
              targetType: 'booking',
              targetId: bookingId,
              metadata: { scheduleChangeId: existing.id, supplier, status },
            },
            tx,
          );
          if (!byTraveller) outcome.resolved.push({ id: existing.id, status });
        } else if (existing.status === 'open' && existing.acceptable !== change.acceptable) {
          await tx.flightScheduleChange.update({
            where: { id: existing.id },
            data: { acceptable: change.acceptable },
          });
          if (!change.acceptable) outcome.unacceptable.push(existing.id);
        }
        if (status === 'open' && existing?.status !== 'accepted') open += 1;
      }

      // The booked itinerary stays while the traveller has a change to decide on.
      const payload = itemPayload(item) as FlightItemPayload;
      if (
        open === 0 &&
        result.slices.length > 0 &&
        itinerarySignature(result.slices) !== itinerarySignature(payload.offer.slices)
      ) {
        await tx.bookingItem.update({
          where: { id: itemId },
          data: {
            payload: toJsonValue(withSlices(payload, result.slices)) as Prisma.InputJsonValue,
          },
        });
        await this.audit.record(
          {
            action: 'booking.itinerary_updated',
            actorType: 'system',
            targetType: 'booking',
            targetId: bookingId,
            metadata: { supplier, bookingItemId: itemId },
          },
          tx,
        );
        outcome.itineraryUpdated = true;
      }
      return { ...outcome, bookingId, reference: item.booking.reference };
    });
  }

  /** Messages and documents follow the committed change, off the caller's path. */
  private afterSync(sync: SyncResult & { bookingId: string; reference: string }): void {
    for (const id of sync.detected) {
      this.background.run('schedule-change-notice', () => this.notifyDetected(id, sync.reference));
    }
    for (const { id, status } of sync.resolved) {
      // Cancelled or changed with the airline elsewhere: the booking needs a person.
      if (status === 'cancelled' || status === 'changed') {
        this.background.run('schedule-change-ops', () =>
          this.notifications.ops('airline.schedule_change_resolved', sync.reference, {
            scheduleChangeId: id,
            status,
          }),
        );
      }
    }
    for (const id of sync.unacceptable) {
      this.background.run('schedule-change-ops', () =>
        this.notifications.ops('airline.schedule_change', sync.reference, {
          scheduleChangeId: id,
          acceptable: 'false',
        }),
      );
    }
    if (sync.itineraryUpdated) {
      // The e-ticket shows the flights: render it again with the new times.
      this.background.run('booking-documents', () => this.documents.ensure(sync.bookingId, true));
    }
  }

  private async notifyDetected(id: string, reference: string): Promise<void> {
    const change = await this.prisma.flightScheduleChange.findUniqueOrThrow({ where: { id } });
    if (change.status === 'open' && !change.acceptable) {
      await this.notifications.ops('airline.schedule_change', reference, {
        scheduleChangeId: id,
        supplier: change.supplier,
      });
    }
    await this.notifications.scheduleChanged(id);
  }
}

const withSlices = (payload: FlightItemPayload, slices: FlightSlice[]): FlightItemPayload => ({
  ...payload,
  offer: { ...payload.offer, slices },
});
