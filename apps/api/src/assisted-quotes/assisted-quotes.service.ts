import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  ASSISTED_QUOTE_OPEN_LIMIT,
  assistedOfferDetailsSchema,
  assistedQuoteRequestSchema,
  money,
  toWire,
  type AssistedBookingFailure,
  type AssistedQuoteCloseReason,
  type AssistedQuoteInput,
} from '@suskii/shared';

import type { StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { bookingReference } from '../bookings/booking-codes';
import { priceItem } from '../bookings/booking-pricing';
import {
  INHOUSE_SUPPLIER,
  inhouseOfferId,
  type AssistedItemPayload,
} from '../bookings/inhouse-items';
import { TicketingService } from '../bookings/ticketing.service';
import { toJsonValue } from '../common/json';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { AssistedQuote, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { assistedQuoteMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';
import { PricingService } from '../pricing/pricing.service';
import { toPriceDto } from '../pricing/pricing.schemas';
import { withCurrentTier } from '../prime/prime-status';

import type {
  AdminAssistedQuoteDto,
  AssistedQuoteDto,
  OfferAssistedQuoteInput,
} from './assisted-quotes.schemas';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const problem = (status: number, slug: string, title: string, detail?: string) =>
  new ProblemDetailsException(status, slug, title, detail);

/** On when set; unset means on outside production and off in production (ADR-104). */
export const assistedQuotesEnabled = (config: AppConfig): boolean =>
  config.ASSISTED_QUOTES_ENABLED ?? config.NODE_ENV !== 'production';

/**
 * Assisted quotes (ADR-104). A traveller asks for a price to be confirmed by a person: for
 * something seen on another website (an indicative price is never sold as it is), or for
 * something the ordinary search does not sell. Staff verify it with the supplier and answer
 * with an offer: an ordinary `Offer` of the `assisted` vertical, booked and paid through the
 * ordinary checkout. Staff then book it with the supplier by hand, and only their record of
 * the supplier's confirmation confirms the booking; if it cannot be booked, everything paid
 * goes back. Nothing here takes a payment, and no agent decides any of it.
 */
@Injectable()
export class AssistedQuotesService {
  private readonly logger = new Logger(AssistedQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly pricing: PricingService,
    private readonly ticketing: TicketingService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  enabled(): boolean {
    return assistedQuotesEnabled(this.config);
  }

  /** Throws 404 while assisted quotes are off, as if the routes did not exist. */
  require(): void {
    if (!this.enabled()) throw new NotFoundException();
  }

  // --- The traveller -----------------------------------------------------------------------

  async request(
    userId: string,
    input: AssistedQuoteInput,
    now = new Date(),
  ): Promise<AssistedQuoteDto> {
    this.require();
    // What the price seen elsewhere was, copied: the observation itself is purged on its own
    // schedule, and one that was rejected or is not a price is not a reference for anything.
    const observation = input.observationId
      ? await this.prisma.priceObservation.findUnique({
          where: { id: input.observationId },
          include: { source: { select: { name: true } } },
        })
      : null;
    if (input.observationId && (!observation || observation.status === 'rejected')) {
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'assisted-quote-reference',
        'That price is no longer available as a reference',
        'Ask again without it, or search again.',
      );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const open = await tx.assistedQuote.count({
        where: { userId, status: { in: ['requested', 'offered'] } },
      });
      if (open >= ASSISTED_QUOTE_OPEN_LIMIT) {
        throw problem(
          HttpStatus.CONFLICT,
          'assisted-quote-limit',
          'Too many open requests',
          `Up to ${ASSISTED_QUOTE_OPEN_LIMIT} requests can wait at once; withdraw one first.`,
        );
      }
      return tx.assistedQuote.create({
        data: {
          reference: `Q-${bookingReference()}`,
          userId,
          product: input.product,
          title: input.title,
          request: input.request,
          currency: input.currency,
          observationId: observation?.id ?? null,
          referenceMinor: observation?.amountMinor ?? null,
          referenceCurrency: observation?.currency ?? null,
          referenceSource: observation?.source.name.slice(0, 120) ?? null,
          referenceSeenAt: observation?.observedAt ?? null,
          expiresAt: new Date(now.getTime() + this.config.ASSISTED_QUOTE_REQUEST_HOURS * HOUR_MS),
        },
      });
    });
    return this.present(row);
  }

  async list(userId: string): Promise<AssistedQuoteDto[]> {
    this.require();
    await this.expireDue({ userId });
    const rows = await this.prisma.assistedQuote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return Promise.all(rows.map((row) => this.present(row)));
  }

  /** The quote if it is the caller's; 404 otherwise, whatever the reason. */
  async get(id: string, userId: string): Promise<AssistedQuoteDto> {
    this.require();
    await this.expireDue({ id });
    const row = await this.prisma.assistedQuote.findUnique({ where: { id } });
    if (row?.userId !== userId) throw new NotFoundException();
    return this.present(row);
  }

  /** The traveller no longer wants it. A quote that became a booking is cancelled as one. */
  async withdraw(id: string, userId: string): Promise<AssistedQuoteDto> {
    const before = await this.get(id, userId);
    if (before.status !== 'requested' && before.status !== 'offered') throw this.closed();
    const claimed = await this.prisma.assistedQuote.updateMany({
      where: { id, userId, status: { in: ['requested', 'offered'] } },
      data: { status: 'withdrawn', closedReason: 'withdrawn' },
    });
    if (claimed.count === 0) throw this.closed();
    return this.get(id, userId);
  }

  // --- Staff -------------------------------------------------------------------------------

  async queue(
    queue: 'to_verify' | 'to_book' | 'all',
    limit: number,
  ): Promise<AdminAssistedQuoteDto[]> {
    this.require();
    await this.expireDue({});
    if (queue === 'to_book') {
      // Paid, and waiting for a person to book it with the supplier: oldest payment first.
      const items = await this.prisma.bookingItem.findMany({
        where: {
          type: 'assisted',
          bookedAt: null,
          booking: { status: { in: ['PAID', 'TICKETING'] } },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { offerId: true },
      });
      const rows = await this.prisma.assistedQuote.findMany({
        where: { offerId: { in: items.map((item) => item.offerId) } },
      });
      const order = new Map(items.map((item, index) => [item.offerId, index]));
      rows.sort((a, b) => (order.get(a.offerId ?? '') ?? 0) - (order.get(b.offerId ?? '') ?? 0));
      return Promise.all(rows.map((row) => this.presentForStaff(row)));
    }
    const rows = await this.prisma.assistedQuote.findMany({
      where: queue === 'to_verify' ? { status: 'requested' } : {},
      // The queue shows its age: who waited longest comes first.
      orderBy: { createdAt: queue === 'to_verify' ? 'asc' : 'desc' },
      take: limit,
    });
    return Promise.all(rows.map((row) => this.presentForStaff(row)));
  }

  async forStaff(id: string): Promise<AdminAssistedQuoteDto> {
    this.require();
    await this.expireDue({ id });
    const row = await this.prisma.assistedQuote.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return this.presentForStaff(row);
  }

  /**
   * Staff verified the live price with the supplier: the request becomes an offer the
   * traveller can book for `ASSISTED_QUOTE_VALID_MINUTES`. Verifying again (the offer lapsed,
   * or the price moved) replaces the offer; one that already became a booking cannot change.
   */
  async offer(
    id: string,
    input: OfferAssistedQuoteInput,
    staff: StaffActor,
    now = new Date(),
  ): Promise<AdminAssistedQuoteDto> {
    const before = await this.forStaff(id);
    if (before.booking) throw this.closed();
    if (!['requested', 'offered', 'expired'].includes(before.status)) throw this.closed();
    const request = assistedQuoteRequestSchema.parse(before.request);
    const details = assistedOfferDetailsSchema.parse(input.details);
    const supplierPrice = money(
      BigInt(input.supplierPrice.amountMinor),
      input.supplierPrice.currency,
    );
    if (supplierPrice.minor <= 0n) {
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'assisted-quote-price',
        'The supplier price must be more than nothing',
      );
    }
    const payload: AssistedItemPayload = {
      kind: 'assisted',
      productId: before.id,
      slug: before.reference.toLowerCase(),
      title: details.title,
      sample: false,
      artKey: null,
      travellers: { adults: request.adults, children: request.children, infants: 0 },
      quoteId: before.id,
      product: before.product,
      summary: details.summary,
      startDate: details.startDate,
      endDate: details.endDate,
      cityName: details.cityName,
      countryCode: details.countryCode,
      refundable: details.refundable,
      unitPrice: supplierPrice,
      request: { kind: 'assisted', quoteId: before.id },
    };
    // The traveller's price: the verified supplier price through the pricing engine, under
    // the rules of the `assisted` vertical alone (a service fee, taxes), never below it.
    const [pricer, client] = await Promise.all([
      this.pricing.pricer('assisted', before.currency),
      withCurrentTier(this.prisma, {
        channel: null,
        userTier: 'member',
        userId: before.userId,
        benefits: null,
        country: null,
      }),
    ]);
    const { breakdown } = priceItem(pricer, payload, client, now);
    const expiresAt = new Date(
      now.getTime() + this.config.ASSISTED_QUOTE_VALID_MINUTES * MINUTE_MS,
    );

    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.create({
        data: {
          vertical: 'assisted',
          supplier: INHOUSE_SUPPLIER,
          supplierOfferId: inhouseOfferId(payload),
          payload: toJsonValue(payload) as Prisma.InputJsonValue,
          supplierTotalMinor: breakdown.supplierTotal.minor,
          supplierCurrency: breakdown.supplierTotal.currency,
          price: toPriceDto(breakdown),
          totalMinor: breakdown.total.minor,
          currency: before.currency,
          userId: before.userId,
          expiresAt,
        },
      });
      // A conditional update claims the answer: two people cannot both offer, and a request
      // the traveller withdrew meanwhile gets none.
      const claimed = await tx.assistedQuote.updateMany({
        where: { id, status: { in: ['requested', 'offered', 'expired'] } },
        data: {
          status: 'offered',
          closedReason: null,
          supplierName: input.supplierName,
          supplierMinor: supplierPrice.minor,
          // The verified price is kept in the supplier's own currency.
          supplierCurrency: supplierPrice.currency,
          evidenceUrl: input.evidenceUrl,
          details: details,
          verifiedBy: staff.userId,
          verifiedAt: now,
          offerId: offer.id,
          offerExpiresAt: expiresAt,
        },
      });
      if (claimed.count === 0) throw this.closed();
      await this.audit.record(
        {
          action: 'assisted_quote.offered',
          actorUserId: staff.userId,
          targetType: 'assisted_quote',
          targetId: id,
          context: staff.context,
          metadata: {
            supplierMinor: supplierPrice.minor.toString(),
            supplierCurrency: supplierPrice.currency,
            totalMinor: breakdown.total.minor.toString(),
            currency: before.currency,
            again: before.status !== 'requested',
          },
        },
        tx,
      );
    });
    await this.tell(before.userId, id, before.reference, 'offered');
    return this.forStaff(id);
  }

  /** Staff could not get it: the request closes and the traveller is told why, as a code. */
  async close(
    id: string,
    reason: AssistedQuoteCloseReason,
    staff: StaffActor,
  ): Promise<AdminAssistedQuoteDto> {
    const before = await this.forStaff(id);
    if (before.booking) throw this.closed();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assistedQuote.updateMany({
        where: { id, status: { in: ['requested', 'offered'] } },
        data: { status: 'unavailable', closedReason: reason },
      });
      if (claimed.count === 0) throw this.closed();
      await this.audit.record(
        {
          action: 'assisted_quote.closed',
          actorUserId: staff.userId,
          targetType: 'assisted_quote',
          targetId: id,
          context: staff.context,
          metadata: { reason },
        },
        tx,
      );
    });
    await this.tell(before.userId, id, before.reference, 'unavailable');
    return this.forStaff(id);
  }

  /**
   * Staff booked the paid booking with the supplier: their record of the supplier's
   * confirmation, with where the proof is kept, is what confirms the booking (ADR-104).
   */
  async booked(
    id: string,
    input: { supplierReference: string; evidenceUrl: string },
    staff: StaffActor,
  ): Promise<AdminAssistedQuoteDto> {
    const before = await this.forStaff(id);
    if (!before.booking?.waitsToBeBooked) throw this.notWaiting();
    const confirmed = await this.ticketing.confirmByHand(
      before.booking.id,
      input.supplierReference,
    );
    if (!confirmed) throw this.notWaiting();
    await this.prisma.assistedQuote.update({
      where: { id },
      data: { bookingEvidenceUrl: input.evidenceUrl },
    });
    await this.audit.record({
      action: 'assisted_quote.booked',
      actorUserId: staff.userId,
      targetType: 'assisted_quote',
      targetId: id,
      context: staff.context,
      metadata: { bookingId: before.booking.id },
    });
    return this.forStaff(id);
  }

  /** Staff could not book the paid booking: everything paid goes back to the traveller. */
  async unbookable(
    id: string,
    reason: AssistedBookingFailure,
    staff: StaffActor,
  ): Promise<AdminAssistedQuoteDto> {
    const before = await this.forStaff(id);
    if (!before.booking?.waitsToBeBooked) throw this.notWaiting();
    const refunded = await this.ticketing.abandon(before.booking.id, `assisted_${reason}`);
    if (!refunded) throw this.notWaiting();
    await this.audit.record({
      action: 'assisted_quote.unbookable',
      actorUserId: staff.userId,
      targetType: 'assisted_quote',
      targetId: id,
      context: staff.context,
      metadata: { bookingId: before.booking.id, reason },
    });
    return this.forStaff(id);
  }

  // --- Shared ------------------------------------------------------------------------------

  /**
   * Closes what ran out of time: a request nobody answered, an offer nobody booked. Reads run
   * it for the rows they are about to show, so a quote never looks open after its time.
   */
  async expireDue(scope: { id?: string; userId?: string }, now = new Date()): Promise<number> {
    const where = {
      ...(scope.id ? { id: scope.id } : {}),
      ...(scope.userId ? { userId: scope.userId } : {}),
    };
    const unanswered = await this.prisma.assistedQuote.updateMany({
      where: { ...where, status: 'requested', expiresAt: { lte: now } },
      data: { status: 'expired', closedReason: 'unanswered' },
    });
    // An offer that became a booking is not lapsed: the booking carries on from it.
    const lapsed = await this.prisma.assistedQuote.findMany({
      where: { ...where, status: 'offered', offerExpiresAt: { lte: now } },
      select: { id: true, offerId: true },
    });
    let closed = unanswered.count;
    for (const quote of lapsed) {
      const booked = quote.offerId
        ? await this.prisma.bookingItem.count({ where: { offerId: quote.offerId } })
        : 0;
      const result = await this.prisma.assistedQuote.updateMany({
        where: { id: quote.id, status: 'offered' },
        data:
          booked > 0
            ? { status: 'booked', closedReason: null }
            : { status: 'expired', closedReason: 'offer_lapsed' },
      });
      closed += booked > 0 ? 0 : result.count;
    }
    return closed;
  }

  private closed(): ProblemDetailsException {
    return problem(
      HttpStatus.CONFLICT,
      'assisted-quote-closed',
      'This request can no longer be changed',
      'It was answered, withdrawn, booked or ran out of time.',
    );
  }

  private notWaiting(): ProblemDetailsException {
    return problem(
      HttpStatus.CONFLICT,
      'assisted-booking-not-waiting',
      'This booking is not waiting to be booked',
      'It is unpaid, held for a payment review, already booked or already refunded.',
    );
  }

  /** The booking made from the quote's offer, if the traveller made one. */
  private async bookingOf(row: AssistedQuote) {
    if (!row.offerId) return null;
    const item = await this.prisma.bookingItem.findFirst({
      where: { offerId: row.offerId },
      orderBy: { createdAt: 'desc' },
      select: {
        bookedAt: true,
        supplierReference: true,
        booking: { select: { id: true, reference: true, status: true } },
      },
    });
    return item;
  }

  private async present(row: AssistedQuote): Promise<AssistedQuoteDto> {
    const [item, offer] = await Promise.all([
      this.bookingOf(row),
      row.offerId
        ? this.prisma.offer.findUnique({
            where: { id: row.offerId },
            select: { totalMinor: true, currency: true },
          })
        : null,
    ]);
    return this.view(row, offer, item?.booking.id ?? null);
  }

  private view(
    row: AssistedQuote,
    offer: { totalMinor: bigint; currency: string } | null,
    bookingId: string | null,
  ): AssistedQuoteDto {
    const details = assistedOfferDetailsSchema.safeParse(row.details);
    // A quote whose offer was booked reads as booked, whether or not a sweep has noted it.
    const status = bookingId && row.status === 'offered' ? 'booked' : row.status;
    return {
      id: row.id,
      reference: row.reference,
      product: row.product,
      title: row.title,
      request: assistedQuoteRequestSchema.parse(row.request),
      currency: row.currency,
      status,
      closedReason: row.closedReason,
      indicative:
        row.referenceMinor !== null && row.referenceSource && row.referenceSeenAt
          ? {
              price: toWire(money(row.referenceMinor, row.referenceCurrency ?? row.currency)),
              source: row.referenceSource,
              seenAt: row.referenceSeenAt.toISOString(),
            }
          : null,
      offer:
        row.offerId && offer && row.offerExpiresAt && details.success && status === 'offered'
          ? {
              quoteId: row.offerId,
              total: toWire(money(offer.totalMinor, offer.currency)),
              details: details.data,
              expiresAt: row.offerExpiresAt.toISOString(),
            }
          : null,
      bookingId,
      answerBy: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async presentForStaff(row: AssistedQuote): Promise<AdminAssistedQuoteDto> {
    const [item, offer] = await Promise.all([
      this.bookingOf(row),
      row.offerId
        ? this.prisma.offer.findUnique({
            where: { id: row.offerId },
            select: { totalMinor: true, currency: true },
          })
        : null,
    ]);
    const booking = item?.booking ?? null;
    return {
      ...this.view(row, offer, booking?.id ?? null),
      userId: row.userId,
      supplierName: row.supplierName,
      supplierPrice:
        row.supplierMinor !== null && row.supplierCurrency
          ? toWire(money(row.supplierMinor, row.supplierCurrency))
          : null,
      evidenceUrl: row.evidenceUrl,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      booking:
        booking && item
          ? {
              id: booking.id,
              reference: booking.reference,
              status: booking.status,
              waitsToBeBooked:
                item.bookedAt === null &&
                (booking.status === 'PAID' || booking.status === 'TICKETING'),
              supplierReference: item.supplierReference,
              evidenceUrl: row.bookingEvidenceUrl,
            }
          : null,
    };
  }

  /** Tells the traveller their request was answered. A failure to tell never undoes the answer. */
  private async tell(
    userId: string,
    quoteId: string,
    reference: string,
    outcome: 'offered' | 'unavailable',
  ): Promise<void> {
    try {
      await this.notifications.notify(
        userId,
        assistedQuoteMessage({
          reference,
          outcome,
          url: `${this.config.WEB_APP_URL.replace(/\/$/, '')}/quotes/${quoteId}`,
          validMinutes: this.config.ASSISTED_QUOTE_VALID_MINUTES,
        }),
      );
    } catch (error) {
      this.logger.warn(
        { quoteId, error: error instanceof Error ? error.name : 'unknown' },
        'the traveller could not be told about an assisted quote',
      );
    }
  }
}
