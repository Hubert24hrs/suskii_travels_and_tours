import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { transliterateName } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { itemPayload } from '../bookings/booking-presenter';
import { BookingsService, type BookingCaller } from '../bookings/bookings.service';
import { tripFacts, type TripFacts } from '../bookings/trip-facts';
import { ProblemDetailsException } from '../common/problem-details';
import { HmacService } from '../crypto/hmac.service';
import type { BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type { AddonLinkRequest, addonLinkSchema } from './inhouse.schemas';

/** A link token is good for this long: enough to choose and pay for an add-on. */
const LINK_TTL_MS = 2 * 3_600_000;

/** Trips that can take add-ons: paid, being paid or confirmed; never an add-on itself. */
const LINKABLE: readonly BookingStatus[] = [
  'HELD',
  'PARTIALLY_PAID',
  'PAID',
  'TICKETING',
  'CONFIRMED',
];

export const notLinkable = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'not-linkable',
    'Add-ons cannot be added to this booking',
    'Only paid or confirmed trips take add-ons.',
  );

export const linkInvalid = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'link-invalid',
    'This booking link has expired',
    'Find the booking again to add an add-on.',
  );

/** Same answer for a wrong reference and a wrong name, so neither can be probed. */
const bookingNotFound = (): NotFoundException => new NotFoundException();

export interface LinkedTrip {
  bookingId: string;
  reference: string;
  trip: TripFacts;
}

/**
 * Attaching add-ons to an existing trip (ADR-027). The traveller proves access from the booking
 * page (session or guest token) or with the reference and a passenger's last name; the answer is
 * a short-lived signed token plus the trip facts an add-on needs, never personal data.
 */
@Injectable()
export class AddonLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly hmac: HmacService,
    private readonly audit: AuditService,
  ) {}

  async issue(
    request: AddonLinkRequest,
    caller: BookingCaller,
  ): Promise<z.infer<typeof addonLinkSchema>> {
    let bookingId: string;
    let via: 'booking' | 'reference';
    if ('bookingId' in request) {
      bookingId = (await this.bookings.load(request.bookingId, caller)).id;
      via = 'booking';
    } else {
      bookingId = await this.findByReference(request.reference, request.lastName);
      via = 'reference';
    }
    const linked = await this.linkable(bookingId);
    const expires = Date.now() + LINK_TTL_MS;
    await this.audit.record({
      action: 'booking.addon_link_issued',
      actorUserId: caller.client.userId,
      targetType: 'booking',
      targetId: bookingId,
      context: caller.context,
      metadata: { via },
    });
    return {
      linkToken: this.sign(bookingId, expires),
      expiresAt: new Date(expires).toISOString(),
      trip: {
        reference: linked.reference,
        countryCode: linked.trip.countryCode,
        cityName: linked.trip.cityName,
        startDate: linked.trip.startDate,
        endDate: linked.trip.endDate,
        travellers: { ...linked.trip.travellers },
      },
    };
  }

  /** The trip behind a link token; 422 `link-invalid` when it expired or was altered. */
  async verify(token: string): Promise<LinkedTrip> {
    const [bookingId, expiresText, signature] = token.split('.');
    const expires = Number(expiresText);
    if (
      !bookingId ||
      !signature ||
      !Number.isSafeInteger(expires) ||
      expires < Date.now() ||
      !this.hmac.verify('addon-link', `${bookingId}.${expires}`, signature)
    ) {
      throw linkInvalid();
    }
    return this.linkable(bookingId);
  }

  private sign(bookingId: string, expires: number): string {
    return `${bookingId}.${expires}.${this.hmac.digest('addon-link', `${bookingId}.${expires}`)}`;
  }

  private async findByReference(reference: string, lastName: string): Promise<string> {
    const surname = transliterateName(lastName);
    if (!surname) throw bookingNotFound();
    const booking = await this.prisma.booking.findUnique({
      where: { reference: reference.toUpperCase() },
      select: { id: true, passengers: { select: { surname: true } } },
    });
    if (!booking?.passengers.some((passenger) => passenger.surname === surname)) {
      throw bookingNotFound();
    }
    return booking.id;
  }

  private async linkable(bookingId: string): Promise<LinkedTrip> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        reference: true,
        status: true,
        vertical: true,
        items: { select: { payload: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!booking) throw bookingNotFound();
    const item = booking.items[0];
    const trip = item ? tripFacts(itemPayload(item)) : null;
    if (!trip || booking.vertical === 'travel_addons' || !LINKABLE.includes(booking.status)) {
      throw notLinkable();
    }
    return { bookingId: booking.id, reference: booking.reference, trip };
  }
}
