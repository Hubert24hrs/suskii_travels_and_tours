import { randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  formatVoucherCode,
  primeTermEnd,
  RIDE_PIN_LENGTH,
  VOUCHER_ALPHABET,
  VOUCHER_CODE_LENGTH,
  VOUCHER_QR_PREFIX,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PasswordHasher } from '../crypto/password-hasher';
import { uuidv7 } from '../common/uuid';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { randomCode } from '../crypto/random';
import type { BookingVoucher, Prisma } from '../generated/prisma/client';

import type { BookingItemRecord, BookingRecord } from './booking-presenter';
import type { InhouseItemPayload } from './inhouse-items';
import { ridePinContext, voucherContext } from '../crypto/encryption-contexts';

type Tx = Prisma.TransactionClient;

export { voucherContext };

/** A voucher as shown to its owner: the code grouped for reading and the QR payload. */
export interface VoucherView {
  code: string;
  qrPayload: string;
  redeemedAt: Date | null;
}

/**
 * Fulfils in-house items when a paid booking is confirmed (ADR-028): packages, tours and add-ons
 * get a voucher with a random code (only its HMAC is looked up; the code is kept encrypted for
 * the PDF), visa assistance opens one application per applicant, a Prime membership starts a
 * term, or extends the member's current one from its end (ADR-030), and bus seats get one
 * boarding pass each (ADR-050).
 */
@Injectable()
export class InhouseFulfilment {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hmac: HmacService,
    private readonly encryption: FieldEncryption,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
  ) {}

  /** Idempotent: an item that already has its voucher or applications is left as it is. */
  async fulfil(
    tx: Tx,
    booking: BookingRecord,
    item: BookingItemRecord,
    payload: InhouseItemPayload,
  ): Promise<void> {
    if (payload.kind === 'visa') {
      await this.openApplications(tx, booking, payload);
    } else if (payload.kind === 'membership') {
      await this.startMembership(tx, booking, payload);
    } else if (payload.kind === 'bus') {
      await this.issueBusTickets(tx, booking.id, item.id);
    } else if (payload.kind === 'ride') {
      await this.createRide(tx, booking, item.id, payload);
    } else {
      const existing = await tx.bookingVoucher.findUnique({ where: { bookingItemId: item.id } });
      if (!existing) await this.createVoucher(tx, booking.id, item.id);
    }
    await tx.bookingItem.update({ where: { id: item.id }, data: { bookedAt: new Date() } });
  }

  private async startMembership(
    tx: Tx,
    booking: BookingRecord,
    payload: Extract<InhouseItemPayload, { kind: 'membership' }>,
  ): Promise<void> {
    if (!booking.userId) throw new Error(`Membership booking ${booking.id} has no account`);
    const exists = await tx.primeMembership.findUnique({
      where: { bookingId: booking.id },
      select: { id: true },
    });
    if (exists) return;
    // Serialise with other purchases by the same member so two terms cannot overlap.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${booking.userId}::uuid FOR UPDATE`;
    const now = new Date();
    const latest = await tx.primeMembership.findFirst({
      where: { userId: booking.userId, status: 'active', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    });
    const startsAt = latest?.endsAt ?? now;
    const membership = await tx.primeMembership.create({
      data: {
        userId: booking.userId,
        planId: payload.productId,
        bookingId: booking.id,
        startsAt,
        endsAt: primeTermEnd(startsAt, payload.period),
        benefits: { ...payload.benefits },
      },
    });
    await this.audit.record(
      {
        action: 'prime.membership_started',
        actorType: 'system',
        targetType: 'prime_membership',
        targetId: membership.id,
        metadata: { bookingId: booking.id, extended: latest !== null },
      },
      tx,
    );
  }

  /**
   * The paid ride (ADR-049): searching for a driver now, or scheduled until shortly before its
   * pickup time (the dispatcher starts it). Its four-digit PIN is kept as an argon2 hash for the
   * driver's check and encrypted for the rider's screen (ADR-050).
   */
  private async createRide(
    tx: Tx,
    booking: BookingRecord,
    itemId: string,
    payload: Extract<InhouseItemPayload, { kind: 'ride' }>,
  ): Promise<void> {
    if (await tx.ride.findUnique({ where: { bookingItemId: itemId }, select: { id: true } }))
      return;
    if (!booking.userId) throw new Error(`Ride booking ${booking.id} has no account`);
    const now = new Date();
    const leadMs = this.config.RIDE_SCHEDULE_LEAD_MINUTES * 60_000;
    const scheduled =
      payload.scheduledFor !== null && Date.parse(payload.scheduledFor) - leadMs > now.getTime();
    const status = scheduled ? 'scheduled' : 'searching';
    const id = uuidv7();
    const pin = String(randomInt(0, 10_000)).padStart(RIDE_PIN_LENGTH, '0');
    await tx.ride.create({
      data: {
        id,
        bookingId: booking.id,
        bookingItemId: itemId,
        riderUserId: booking.userId,
        category: payload.category,
        status,
        cityName: payload.cityName,
        pickupLabel: payload.pickup.label,
        pickupLat: payload.pickup.lat,
        pickupLng: payload.pickup.lng,
        dropoffLabel: payload.dropoff.label,
        dropoffLat: payload.dropoff.lat,
        dropoffLng: payload.dropoff.lng,
        scheduledFor: payload.scheduledFor ? new Date(payload.scheduledFor) : null,
        polyline: payload.polyline,
        distanceMetres: payload.distanceMetres,
        durationSeconds: payload.durationSeconds,
        fareMinor: booking.totalMinor,
        currency: booking.currency,
        pinHash: await this.hasher.hash(pin),
        pinEncrypted: this.encryption.encrypt(pin, ridePinContext(id)),
        searchStartedAt: scheduled ? null : now,
        events: {
          create: {
            event: 'created',
            fromStatus: status,
            toStatus: status,
            actorKind: 'system',
            metadata: { bookingId: booking.id },
          },
        },
      },
    });
  }

  /** One boarding pass per sold seat (ADR-050); the QR payload is signed when shown. */
  private async issueBusTickets(tx: Tx, bookingId: string, itemId: string): Promise<void> {
    const existing = await tx.busTicket.count({ where: { bookingItemId: itemId } });
    if (existing > 0) return;
    const seats = await tx.busSeatAssignment.findMany({
      where: { bookingItemId: itemId, active: true },
    });
    if (seats.length === 0) throw new Error(`Bus booking item ${itemId} has no seats`);
    await tx.busTicket.createMany({
      data: seats.map((seat) => ({
        bookingId,
        bookingItemId: itemId,
        tripId: seat.tripId,
        seatNumber: seat.seatNumber,
        passengerId: seat.passengerId,
      })),
    });
  }

  private async createVoucher(tx: Tx, bookingId: string, itemId: string): Promise<void> {
    const id = uuidv7();
    const code = randomCode(VOUCHER_ALPHABET, VOUCHER_CODE_LENGTH);
    await tx.bookingVoucher.create({
      data: {
        id,
        bookingId,
        bookingItemId: itemId,
        codeHash: this.hmac.digest('booking-voucher', code),
        codeEncrypted: this.encryption.encrypt(code, voucherContext(id)),
      },
    });
  }

  private async openApplications(
    tx: Tx,
    booking: BookingRecord,
    payload: Extract<InhouseItemPayload, { kind: 'visa' }>,
  ): Promise<void> {
    for (const passenger of booking.passengers) {
      const exists = await tx.visaApplication.findUnique({
        where: {
          bookingId_applicantPosition: {
            bookingId: booking.id,
            applicantPosition: passenger.position,
          },
        },
        select: { id: true },
      });
      if (exists) continue;
      const application = await tx.visaApplication.create({
        data: {
          bookingId: booking.id,
          productId: payload.productId,
          applicantPosition: passenger.position,
          purpose: payload.purpose,
          nationality: passenger.nationality ?? payload.nationality,
          destination: payload.destination,
          travelDate: new Date(`${payload.travelDate}T00:00:00.000Z`),
          events: {
            create: {
              kind: 'opened',
              toStatus: 'awaiting_documents',
              actorType: 'system',
            },
          },
        },
      });
      await this.audit.record(
        {
          action: 'visa.application_opened',
          actorType: 'system',
          targetType: 'visa_application',
          targetId: application.id,
          metadata: { bookingId: booking.id },
        },
        tx,
      );
    }
  }

  /** The voucher's code for its owner's booking page and PDF. */
  view(voucher: BookingVoucher): VoucherView {
    const code = this.encryption.decrypt(voucher.codeEncrypted, voucherContext(voucher.id));
    return {
      code: formatVoucherCode(code),
      qrPayload: `${VOUCHER_QR_PREFIX}${code}`,
      redeemedAt: voucher.redeemedAt,
    };
  }
}
