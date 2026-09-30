import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  BOOKING_TERMS_VERSION,
  checkPassengers,
  contactDetailsSchema,
  equals,
  fromWire,
  MAX_SAVED_TRAVELLERS,
  PASSENGER_ISSUES,
  PASSENGER_TYPES,
  type ContactDetails,
  type PassengerInput,
  type PassengerIssue,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { AttestationService } from '../attestation/attestation.service';
import { TurnstileVerifier } from '../bot-protection/turnstile';
import { BackgroundTasks } from '../common/background-tasks';
import { fromJsonValue, toJsonValue } from '../common/json';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';
import { Prisma, type Traveller } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { FxService } from '../pricing/fx.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { offerUnavailable, promoInvalid, quoteExpired } from '../search/search.errors';

import { bookingReference, documentHint } from './booking-codes';
import {
  BOOKING_INCLUDE,
  bookingPrice,
  pendingPrice,
  toBookingDto,
  toBookingSummary,
  type BookingRecord,
} from './booking-presenter';
import {
  itineraryFacts,
  priceBookingItem,
  totalOf,
  type ExtraSelection,
  type ItemPayload,
  type PromoInput,
} from './booking-pricing';
import { BookingTransitions, type BookingActor } from './booking-transitions';
import {
  botCheckFailed,
  bookingConflict,
  extrasInvalid,
  passengersInvalid,
  priceConsentMismatch,
  termsOutdated,
} from './booking.errors';
import type { BookingDto, BookingSummaryDto, CreateBookingRequest } from './bookings.schemas';
import { BookingAccessLinks } from './booking-access-links';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingFundsService } from './booking-funds.service';

/** Prices are held for at most this long after pricing (ADR-014). */
export const PRICE_HOLD_MS = 30 * 60_000;
const REFERENCE_ATTEMPTS = 5;
const DOCUMENT_BACKFILL_AFTER_MS = 2 * 60_000;

/** Who is asking: the pricing client, request metadata and a guest access token if any. */
export interface BookingCaller {
  client: ClientContext;
  context: RequestContext;
  token: string | null;
  /** Raw `X-Suskii-Attestation` header (mobile guests, ADR-023). */
  attestation?: string | null;
}

interface PreparedPassenger {
  id: string;
  position: number;
  input: PassengerInput;
  passport: { number: string; issuingCountry: string; expiryDate: string } | null;
}

const TYPE_ORDER: Record<(typeof PASSENGER_TYPES)[number], number> = {
  adult: 0,
  child: 1,
  infant: 2,
};

export const customerActor = (caller: BookingCaller): BookingActor => ({
  type: 'customer',
  userId: caller.client.userId,
  context: caller.context,
});

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const earliest = (...dates: Date[]): Date => new Date(Math.min(...dates.map((d) => d.getTime())));

/**
 * Creating, reading, re-consenting and cancelling bookings (ADR-014, ADR-015). Access is by
 * ownership for account bookings and by the HMAC-checked access token for guest bookings; anyone
 * else gets 404.
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly fx: FxService,
    private readonly hmac: HmacService,
    private readonly encryption: FieldEncryption,
    private readonly turnstile: TurnstileVerifier,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly documents: BookingDocumentsService,
    private readonly background: BackgroundTasks,
    private readonly accessLinks: BookingAccessLinks,
    private readonly funds: BookingFundsService,
    private readonly attestation: AttestationService,
  ) {}

  // -------------------------------------------------------------------------
  // Access and presentation
  // -------------------------------------------------------------------------

  /** The booking if the caller owns it or holds its access token; otherwise 404. */
  async load(
    bookingId: string,
    caller: Pick<BookingCaller, 'client' | 'token'>,
  ): Promise<BookingRecord> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });
    if (!booking || !(await this.canAccess(booking, caller))) throw new NotFoundException();
    return booking;
  }

  /** Owner by session; guests by the checkout token or a live access link from an email. */
  private async canAccess(
    booking: { id: string; userId: string | null; accessTokenHash: string | null },
    caller: Pick<BookingCaller, 'client' | 'token'>,
  ): Promise<boolean> {
    if (booking.userId && caller.client.userId === booking.userId) return true;
    if (!caller.token || booking.userId) return false;
    if (
      booking.accessTokenHash &&
      this.hmac.verify('booking-access', caller.token, booking.accessTokenHash)
    ) {
      return true;
    }
    return this.accessLinks.valid(booking.id, caller.token);
  }

  contact(booking: { id: string; contactEncrypted: string }): ContactDetails {
    return contactDetailsSchema.parse(
      JSON.parse(this.encryption.decrypt(booking.contactEncrypted, contactContext(booking.id))),
    );
  }

  async present(booking: BookingRecord): Promise<BookingDto> {
    const now = new Date();
    const [fx, funds] = await Promise.all([
      this.fx.converter(),
      this.funds.forBooking(booking, now),
    ]);
    return toBookingDto(booking, this.contact(booking), fx, now, funds);
  }

  async get(bookingId: string, caller: BookingCaller): Promise<BookingDto> {
    const booking = await this.load(bookingId, caller);
    // A confirmed booking whose documents failed to generate gets them now, off the request.
    // Recent confirmations are left to ticketing, which is still rendering and emailing them.
    const settled =
      booking.confirmedAt !== null &&
      Date.now() - booking.confirmedAt.getTime() > DOCUMENT_BACKFILL_AFTER_MS;
    if (booking.status === 'CONFIRMED' && booking.documents.length === 0 && settled) {
      this.background.run('booking-documents', () => this.documents.ensure(booking.id));
    }
    return this.present(booking);
  }

  /**
   * The account's bookings, newest first (Trips). Only bookings that reached PRICED are listed;
   * the cursor is the last id of the previous page (UUIDv7 ids sort by creation time).
   */
  async listForUser(
    userId: string,
    query: { cursor?: string | undefined; limit: number },
  ): Promise<{ bookings: BookingSummaryDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.booking.findMany({
      where: {
        userId,
        status: { not: 'DRAFT' },
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: {
        id: true,
        reference: true,
        status: true,
        createdAt: true,
        totalMinor: true,
        currency: true,
        items: { select: { payload: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      bookings: page.flatMap((row) => toBookingSummary(row) ?? []),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async reload(bookingId: string): Promise<BookingRecord> {
    return this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async create(
    input: CreateBookingRequest,
    caller: BookingCaller,
  ): Promise<{ booking: BookingDto; accessToken: string | null }> {
    const userId = caller.client.userId;
    if (!userId) {
      // Web guests send Turnstile; the app sends a device attestation instead (ADR-023).
      const verified =
        input.turnstileToken !== null
          ? await this.turnstile.verify(input.turnstileToken, {
              remoteIp: caller.context.ip,
              action: 'checkout',
            })
          : (await this.attestation.verify(caller.attestation ?? undefined, 'checkout')) ===
            'valid';
      if (!verified) throw botCheckFailed();
    }
    if (input.termsVersion !== BOOKING_TERMS_VERSION) throw termsOutdated();

    const quote = await this.prisma.offer.findUnique({ where: { id: input.quoteId } });
    if (!quote) throw new NotFoundException();
    const payload = fromJsonValue<ItemPayload>(quote.payload);
    const now = new Date();
    if (quote.expiresAt <= now) throw offerUnavailable(payload.request);
    if (payload.kind === 'hotel' && !('query' in payload)) throw quoteExpired();

    const passengers = await this.preparePassengers(input, payload, userId);
    const extras = this.prepareExtras(input, payload, passengers);

    let promo: PromoInput = null;
    if (input.promoCode) {
      promo = await this.pricing.findPromo(input.promoCode, userId);
      if (!promo) throw promoInvalid();
    }
    const [pricer, fx] = await Promise.all([
      this.pricing.pricer(quote.vertical, quote.currency),
      this.fx.converter(),
    ]);
    const priced = priceBookingItem(pricer, fx, payload, caller.client, extras, promo, now);
    if (promo && priced.promo?.status !== 'applied') throw promoInvalid();

    const bookingId = uuidv7();
    const itemId = uuidv7();
    const accessToken = userId ? null : randomToken(32);
    const actor = customerActor(caller);
    const offerExpiry = new Date(
      payload.kind === 'flight' ? payload.offer.expiresAt : quote.expiresAt.toISOString(),
    );

    const data = {
      id: bookingId,
      status: 'DRAFT' as const,
      vertical: quote.vertical,
      userId,
      accessTokenHash: accessToken ? this.hmac.digest('booking-access', accessToken) : null,
      contactEncrypted: this.encryption.encrypt(
        JSON.stringify(input.contact),
        contactContext(bookingId),
      ),
      contactEmailHash: this.hmac.digest('booking-email', input.contact.email),
      currency: priced.total.currency,
      totalMinor: priced.total.minor,
      price: priced.price,
      promoCodeId: priced.price.discount ? (promo?.data.id ?? null) : null,
      channel: caller.client.channel ?? 'web',
      locale: input.locale,
      termsVersion: input.termsVersion,
      termsAcceptedAt: now,
      paymentDeadline: earliest(offerExpiry, new Date(now.getTime() + PRICE_HOLD_MS)),
      items: {
        create: [
          {
            id: itemId,
            type: payload.kind,
            offerId: quote.id,
            supplier: quote.supplier,
            supplierOfferId: quote.supplierOfferId,
            payload: toJsonValue(payload) as Prisma.InputJsonValue,
            services: extras as unknown as Prisma.InputJsonValue,
            totalMinor: priced.total.minor,
            currency: priced.total.currency,
          },
        ],
      },
      passengers: {
        create:
          payload.kind === 'flight'
            ? passengers.map((passenger) => this.passengerRow(passenger))
            : input.guests.map((guest, index) => ({
                id: uuidv7(),
                position: index,
                type: 'adult' as const,
                givenNames: guest.givenNames,
                surname: guest.surname,
                roomIndex: index,
              })),
      },
    } satisfies Omit<Prisma.BookingUncheckedCreateInput, 'reference'>;

    await this.insertWithReference(async (tx, reference) => {
      await tx.booking.create({ data: { ...data, reference } });
      await this.transitions.created(tx, { id: bookingId, status: 'DRAFT' }, actor);
      await this.transitions.apply(tx, { id: bookingId, status: 'DRAFT' }, 'price', actor);
      if (userId) await this.saveTravellers(tx, userId, passengers, actor);
    });

    const booking = await this.reload(bookingId);
    return { booking: await this.present(booking), accessToken };
  }

  /** Retries with a fresh reference if one collides (the unique index decides). */
  private async insertWithReference(
    write: (tx: Prisma.TransactionClient, reference: string) => Promise<void>,
  ): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.prisma.$transaction((tx) => write(tx, bookingReference()));
        return;
      } catch (error) {
        const collided =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          JSON.stringify(error.meta ?? {}).includes('reference');
        if (!collided || attempt >= REFERENCE_ATTEMPTS) throw error;
      }
    }
  }

  private passengerRow(
    passenger: PreparedPassenger,
  ): Prisma.BookingPassengerCreateWithoutBookingInput {
    const { input, passport } = passenger;
    return {
      id: passenger.id,
      position: passenger.position,
      type: input.type,
      title: input.title,
      gender: input.gender,
      givenNames: input.givenNames,
      surname: input.surname,
      dateOfBirth: dateOnly(input.dateOfBirth),
      nationality: input.nationality,
      passportEncrypted: passport
        ? this.encryption.encrypt(
            passport.number,
            passportContext('booking-passenger', passenger.id),
          )
        : null,
      documentHint: passport ? documentHint(passport.number) : null,
      issuingCountry: passport?.issuingCountry ?? null,
      documentExpiry: passport ? dateOnly(passport.expiryDate) : null,
      travellerId: input.travellerId,
    };
  }

  /**
   * Resolves saved travellers' passports, checks every passenger against the offer and itinerary,
   * and orders them as suppliers expect (adults, children, infants).
   */
  private async preparePassengers(
    input: CreateBookingRequest,
    payload: ItemPayload,
    userId: string | null,
  ): Promise<PreparedPassenger[]> {
    if (payload.kind === 'hotel') {
      if (input.passengers.length > 0 || input.guests.length !== payload.request.rooms.length) {
        throw passengersInvalid([
          { index: null, path: ['guests'], code: PASSENGER_ISSUES.countMismatch },
        ]);
      }
      return [];
    }
    if (input.guests.length > 0) {
      throw passengersInvalid([
        { index: null, path: ['guests'], code: PASSENGER_ISSUES.countMismatch },
      ]);
    }

    const travellerIds = input.passengers
      .map((passenger) => passenger.travellerId)
      .filter((id): id is string => id !== null);
    const travellers = new Map<string, Traveller>();
    if (travellerIds.length > 0 && userId) {
      const rows = await this.prisma.traveller.findMany({
        where: { id: { in: travellerIds }, userId },
      });
      for (const row of rows) travellers.set(row.id, row);
    }

    const issues: PassengerIssue[] = [];
    const resolved = input.passengers.map((passenger, index) => {
      if (passenger.travellerId === null) {
        const document = passenger.document;
        return document?.number
          ? {
              number: document.number,
              issuingCountry: document.issuingCountry,
              expiryDate: document.expiryDate,
            }
          : null;
      }
      const traveller = travellers.get(passenger.travellerId);
      if (!traveller) {
        issues.push({ index, path: ['travellerId'], code: PASSENGER_ISSUES.travellerNotFound });
        return null;
      }
      const stored = traveller.passportEncrypted
        ? this.encryption.decrypt(
            traveller.passportEncrypted,
            passportContext('traveller', traveller.id),
          )
        : null;
      const document = passenger.document;
      const number = document?.number ?? stored;
      const issuingCountry = document?.issuingCountry ?? traveller.issuingCountry;
      const expiry =
        document?.expiryDate ?? traveller.documentExpiry?.toISOString().slice(0, 10) ?? null;
      return number && issuingCountry && expiry
        ? { number, issuingCountry, expiryDate: expiry }
        : null;
    });
    if (issues.length > 0) throw passengersInvalid(issues);

    const { errors } = checkPassengers(
      input.passengers.map((passenger, index) => ({
        type: passenger.type,
        dateOfBirth: passenger.dateOfBirth,
        document: resolved[index] ? { expiryDate: resolved[index].expiryDate } : null,
      })),
      itineraryFacts(payload),
    );
    if (errors.length > 0) throw passengersInvalid(errors);

    const order = input.passengers
      .map((passenger, index) => ({ passenger, index }))
      .sort(
        (a, b) => TYPE_ORDER[a.passenger.type] - TYPE_ORDER[b.passenger.type] || a.index - b.index,
      );
    const prepared: PreparedPassenger[] = new Array<PreparedPassenger>(input.passengers.length);
    order.forEach(({ passenger, index }, position) => {
      prepared[index] = {
        id: uuidv7(),
        position,
        input: passenger,
        passport: resolved[index] ?? null,
      };
    });
    return prepared;
  }

  /** Validates extras against the offer and maps passenger indexes to booking positions. */
  private prepareExtras(
    input: CreateBookingRequest,
    payload: ItemPayload,
    passengers: PreparedPassenger[],
  ): ExtraSelection[] {
    if (input.extras.length === 0) return [];
    if (payload.kind !== 'flight') throw extrasInvalid();
    const seen = new Set<string>();
    return input.extras.map((extra) => {
      const service = payload.offer.services.find((candidate) => candidate.id === extra.serviceId);
      const passenger = passengers[extra.passengerIndex];
      const key = `${extra.serviceId}|${extra.passengerIndex}`;
      if (
        !service ||
        !passenger ||
        passenger.input.type === 'infant' ||
        extra.quantity > service.maxQuantity ||
        seen.has(key)
      ) {
        throw extrasInvalid();
      }
      seen.add(key);
      return {
        serviceId: service.id,
        passengerIndex: passenger.position,
        quantity: extra.quantity,
        type: service.type,
        weightKg: service.weightKg,
      };
    });
  }

  /** "Save this traveller" at checkout: creates or updates saved travellers (limit permitting). */
  private async saveTravellers(
    tx: Prisma.TransactionClient,
    userId: string,
    passengers: PreparedPassenger[],
    actor: BookingActor,
  ): Promise<void> {
    const toSave = passengers.filter((passenger) => passenger.input.saveTraveller);
    if (toSave.length === 0) return;
    let count = await tx.traveller.count({ where: { userId } });
    for (const { input, passport } of toSave) {
      const fields = {
        title: input.title,
        gender: input.gender,
        givenNames: input.givenNames,
        surname: input.surname,
        dateOfBirth: dateOnly(input.dateOfBirth),
        nationality: input.nationality,
      };
      if (input.travellerId) {
        await tx.traveller.updateMany({
          where: { id: input.travellerId, userId },
          data: {
            ...fields,
            ...(passport
              ? {
                  passportEncrypted: this.encryption.encrypt(
                    passport.number,
                    passportContext('traveller', input.travellerId),
                  ),
                  documentHint: documentHint(passport.number),
                  issuingCountry: passport.issuingCountry,
                  documentExpiry: dateOnly(passport.expiryDate),
                }
              : {}),
          },
        });
        continue;
      }
      // The limit is a soft convenience cap: skipping is better than failing a booking.
      if (count >= MAX_SAVED_TRAVELLERS) continue;
      const id = uuidv7();
      await tx.traveller.create({
        data: {
          id,
          userId,
          ...fields,
          passportEncrypted: passport
            ? this.encryption.encrypt(passport.number, passportContext('traveller', id))
            : null,
          documentHint: passport ? documentHint(passport.number) : null,
          issuingCountry: passport?.issuingCountry ?? null,
          documentExpiry: passport ? dateOnly(passport.expiryDate) : null,
        },
      });
      count += 1;
      await this.audit.record(
        {
          action: 'traveller.created',
          actorUserId: userId,
          targetType: 'traveller',
          targetId: id,
          ...(actor.context ? { context: actor.context } : {}),
          metadata: { source: 'checkout' },
        },
        tx,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Consent and cancel
  // -------------------------------------------------------------------------

  /** Accepts a re-priced total; `total` must equal the pending total exactly. */
  async consent(
    bookingId: string,
    total: { amountMinor: number; currency: string },
    caller: BookingCaller,
  ): Promise<BookingDto> {
    const booking = await this.load(bookingId, caller);
    const agreed = fromWire(total);
    const pending = pendingPrice(booking);
    if (!pending) {
      // Repeating a consent that already went through is harmless.
      if (equals(totalOf(bookingPrice(booking)), agreed)) return this.present(booking);
      throw priceConsentMismatch();
    }
    if (!equals(totalOf(pending.price), agreed)) throw priceConsentMismatch();
    if (booking.status !== 'PRICED' && booking.status !== 'HELD') throw bookingConflict();

    const actor = customerActor(caller);
    const now = new Date();
    const offerExpiry = pending.items
      .map((item) =>
        item.payload.kind === 'flight' ? new Date(item.payload.offer.expiresAt) : null,
      )
      .filter((date): date is Date => date !== null);
    // A held booking keeps its plan's deadline; its single payment becomes the new total.
    const hold =
      booking.paymentPlan?.status === 'active' && booking.paymentPlan.kind === 'hold'
        ? booking.paymentPlan
        : null;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status },
        data: {
          price: pending.price,
          totalMinor: agreed.minor,
          pendingPrice: Prisma.DbNull,
          ...(hold
            ? {}
            : {
                paymentDeadline: earliest(new Date(now.getTime() + PRICE_HOLD_MS), ...offerExpiry),
              }),
        },
      });
      if (count !== 1) throw bookingConflict();
      if (hold) {
        await tx.paymentPlan.update({ where: { id: hold.id }, data: { totalMinor: agreed.minor } });
        await tx.installment.updateMany({
          where: { planId: hold.id, status: 'pending' },
          data: { amountMinor: agreed.minor },
        });
      }
      for (const item of pending.items) {
        await tx.bookingItem.update({
          where: { id: item.id },
          data: {
            supplierOfferId: item.supplierOfferId,
            payload: toJsonValue(item.payload) as Prisma.InputJsonValue,
            services: item.services as unknown as Prisma.InputJsonValue,
            totalMinor: agreed.minor,
          },
        });
      }
      await this.audit.record(
        {
          action: 'booking.price_consented',
          actorUserId: actor.userId ?? null,
          targetType: 'booking',
          targetId: booking.id,
          context: caller.context,
          metadata: {
            previousMinor: booking.totalMinor.toString(),
            currentMinor: agreed.minor.toString(),
            currency: agreed.currency,
          },
        },
        tx,
      );
    });
    return this.present(await this.reload(booking.id));
  }

  async cancel(bookingId: string, caller: BookingCaller): Promise<BookingDto> {
    const booking = await this.load(bookingId, caller);
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: 'pending' },
        data: { status: 'cancelled' },
      });
      await this.transitions.apply(tx, booking, 'cancel', customerActor(caller), {
        reason: 'customer_request',
        data: { pendingPrice: Prisma.DbNull },
      });
    });
    return this.present(await this.reload(booking.id));
  }
}

export const contactContext = (bookingId: string): string => `booking:${bookingId}:contact`;
export const passportContext = (kind: 'booking-passenger' | 'traveller', id: string): string =>
  `${kind}:${id}:passport`;
