import { Injectable } from '@nestjs/common';

import {
  formatVoucherCode,
  VOUCHER_ALPHABET,
  VOUCHER_CODE_LENGTH,
  VOUCHER_QR_PREFIX,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { uuidv7 } from '../common/uuid';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { randomCode } from '../crypto/random';
import type { BookingVoucher, Prisma } from '../generated/prisma/client';

import type { BookingItemRecord, BookingRecord } from './booking-presenter';
import type { InhouseItemPayload } from './inhouse-items';

type Tx = Prisma.TransactionClient;

export const voucherContext = (voucherId: string): string => `booking-voucher:${voucherId}`;

/** A voucher as shown to its owner: the code grouped for reading and the QR payload. */
export interface VoucherView {
  code: string;
  qrPayload: string;
  redeemedAt: Date | null;
}

/**
 * Fulfils in-house items when a paid booking is confirmed (ADR-028): packages, tours and add-ons
 * get a voucher with a random code (only its HMAC is looked up; the code is kept encrypted for
 * the PDF), and visa assistance opens one application per applicant.
 */
@Injectable()
export class InhouseFulfilment {
  constructor(
    private readonly hmac: HmacService,
    private readonly encryption: FieldEncryption,
    private readonly audit: AuditService,
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
    } else {
      const existing = await tx.bookingVoucher.findUnique({ where: { bookingItemId: item.id } });
      if (!existing) await this.createVoucher(tx, booking.id, item.id);
    }
    await tx.bookingItem.update({ where: { id: item.id }, data: { bookedAt: new Date() } });
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
