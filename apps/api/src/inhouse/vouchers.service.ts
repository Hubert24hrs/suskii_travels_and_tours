import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { parseVoucherCode, seatsFor } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { itemPayload } from '../bookings/booking-presenter';
import type { RequestContext } from '../common/request-context';
import { ProblemDetailsException } from '../common/problem-details';
import { HmacService } from '../crypto/hmac.service';
import { PrismaService } from '../infra/prisma.service';

import type { redeemedVoucherSchema } from './inhouse.schemas';

export const voucherRedeemed = (redeemedAt: Date): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'voucher-redeemed',
    'This voucher was already used',
    'Each voucher can be redeemed once.',
    { redeemedAt: redeemedAt.toISOString() },
  );

/**
 * Voucher redemption by operations (ADR-028): the code (typed or scanned) is looked up by its
 * HMAC, redeemed once for a confirmed booking, and the answer carries only what a guide checks:
 * product, date and group size, never names or contact details.
 */
@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly audit: AuditService,
  ) {}

  async redeem(
    input: string,
    staff: { userId: string; context: RequestContext },
  ): Promise<z.infer<typeof redeemedVoucherSchema>> {
    const code = parseVoucherCode(input);
    if (!code) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      const voucher = await tx.bookingVoucher.findUnique({
        where: { codeHash: this.hmac.digest('booking-voucher', code) },
        include: {
          booking: { select: { id: true, reference: true, status: true } },
          bookingItem: { select: { payload: true } },
        },
      });
      // Cancelled or refunded bookings' vouchers are void: same answer as an unknown code.
      if (voucher?.booking.status !== 'CONFIRMED') throw new NotFoundException();
      if (voucher.redeemedAt) throw voucherRedeemed(voucher.redeemedAt);
      const redeemedAt = new Date();
      const { count } = await tx.bookingVoucher.updateMany({
        where: { id: voucher.id, redeemedAt: null },
        data: { redeemedAt, redeemedById: staff.userId },
      });
      if (count !== 1) throw voucherRedeemed(redeemedAt);
      await this.audit.record(
        {
          action: 'booking.voucher_redeemed',
          actorUserId: staff.userId,
          targetType: 'booking',
          targetId: voucher.booking.id,
          context: staff.context,
          metadata: { voucherId: voucher.id },
        },
        tx,
      );
      const payload = itemPayload(voucher.bookingItem);
      if (payload.kind !== 'package' && payload.kind !== 'tour' && payload.kind !== 'addon') {
        throw new NotFoundException();
      }
      return {
        bookingReference: voucher.booking.reference,
        kind: payload.kind,
        title: payload.title,
        startsOn: payload.kind === 'tour' ? payload.startsAtLocal : payload.startDate,
        travellers: seatsFor(payload.travellers),
        redeemedAt: redeemedAt.toISOString(),
      };
    });
  }
}
