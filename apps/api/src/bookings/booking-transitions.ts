import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import type { BookingActorType, BookingStatus, Prisma } from '../generated/prisma/client';

import { bookingConflict } from './booking.errors';
import { canTransition, nextStatus, type BookingEvent } from './booking-state-machine';
import { RELEASING_STATUSES, settleSeats } from './seat-inventory';

type Tx = Prisma.TransactionClient;

export interface BookingActor {
  type: BookingActorType;
  userId?: string | null;
  context?: RequestContext;
}

export const SYSTEM_ACTOR: BookingActor = { type: 'system' };
export const WEBHOOK_ACTOR: BookingActor = { type: 'webhook' };

/** The audit log's actor type for a booking actor. */
function auditActorType(actor: BookingActor): 'user' | 'system' | 'anonymous' {
  if (actor.type === 'system' || actor.type === 'webhook') return 'system';
  return actor.userId ? 'user' : 'anonymous';
}

/**
 * The only way a booking changes status (ADR-014). Each transition is checked against the state
 * machine, applied with an optimistic guard on the current status (a concurrent change makes it
 * fail instead of overwriting), and recorded in `booking_status_history` and the audit log inside
 * the caller's transaction. Reserved package and tour seats are sold on confirmation and released
 * when the booking ends without one.
 */
@Injectable()
export class BookingTransitions {
  constructor(private readonly audit: AuditService) {}

  /** History and audit rows for a booking that was just inserted with `status`. */
  async created(
    tx: Tx,
    booking: { id: string; status: BookingStatus },
    actor: BookingActor,
  ): Promise<void> {
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: null,
        toStatus: booking.status,
        event: 'created',
        actorType: actor.type,
        actorUserId: actor.userId ?? null,
      },
    });
    await this.audit.record(
      {
        action: 'booking.created',
        actorType: auditActorType(actor),
        actorUserId: actor.userId ?? null,
        targetType: 'booking',
        targetId: booking.id,
        ...(actor.context ? { context: actor.context } : {}),
        metadata: { status: booking.status },
      },
      tx,
    );
  }

  /** Applies `event`; throws 409 when the booking is not in `from` any more. */
  async apply(
    tx: Tx,
    booking: { id: string; status: BookingStatus },
    event: BookingEvent,
    actor: BookingActor,
    options: { reason?: string; data?: Prisma.BookingUpdateManyMutationInput } = {},
  ): Promise<BookingStatus> {
    if (!canTransition(booking.status, event)) throw bookingConflict();
    const to = nextStatus(booking.status, event);
    const { count } = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { ...options.data, status: to },
    });
    if (count !== 1) throw bookingConflict();
    // Package and tour seats follow the booking (ADR-025), in the same transaction.
    if (to === 'CONFIRMED') await settleSeats(tx, booking.id, 'sold');
    else if (RELEASING_STATUSES.includes(to)) await settleSeats(tx, booking.id, 'released');
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: to,
        event,
        reason: options.reason ?? null,
        actorType: actor.type,
        actorUserId: actor.userId ?? null,
      },
    });
    await this.audit.record(
      {
        action: 'booking.status_changed',
        actorType: auditActorType(actor),
        actorUserId: actor.userId ?? null,
        targetType: 'booking',
        targetId: booking.id,
        ...(actor.context ? { context: actor.context } : {}),
        metadata: {
          from: booking.status,
          to,
          event,
          ...(options.reason ? { reason: options.reason } : {}),
        },
      },
      tx,
    );
    return to;
  }
}
