import { Injectable } from '@nestjs/common';

import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

/**
 * Expiring links that let a guest reopen their booking from an email (ADR-018, extends ADR-015).
 * The random token travels in the URL fragment and is stored only as an HMAC; it grants what the
 * checkout token grants, until it expires.
 */
@Injectable()
export class BookingAccessLinks {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
  ) {}

  /** Creates a link token; the raw token is returned once, for the email, and never stored. */
  async create(
    db: Prisma.TransactionClient | PrismaService,
    bookingId: string,
    purpose: string,
    expiresAt: Date,
  ): Promise<string> {
    const token = randomToken(32);
    await db.bookingAccessLink.create({
      data: {
        bookingId,
        purpose,
        expiresAt,
        tokenHash: this.hmac.digest('booking-access-link', token),
      },
    });
    return token;
  }

  /** Whether `token` is a live link for this booking. */
  async valid(bookingId: string, token: string): Promise<boolean> {
    const link = await this.prisma.bookingAccessLink.findUnique({
      where: { tokenHash: this.hmac.digest('booking-access-link', token) },
      select: { bookingId: true, expiresAt: true },
    });
    return link?.bookingId === bookingId && link.expiresAt > new Date();
  }
}

/** `…/bookings/{id}#access={token}`: the fragment never reaches servers, logs or Referer. */
export const accessLinkUrl = (bookingUrl: string, token: string): string =>
  `${bookingUrl}#access=${token}`;
