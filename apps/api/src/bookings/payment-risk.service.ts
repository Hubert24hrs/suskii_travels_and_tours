import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Booking, Payment, Prisma } from '../generated/prisma/client';

import { itemPayload } from './booking-presenter';
import { tripFacts } from './trip-facts';

type Tx = Prisma.TransactionClient;

/**
 * What each signal adds to a payment's risk score (ADR-040). One signal alone stays below the
 * default review score (60); two independent ones reach it.
 */
export const RISK_WEIGHTS = {
  /** The account paid for more bookings than PAYMENT_RISK_MAX_PAYMENTS_PER_DAY in 24 hours. */
  velocity_account: 40,
  /** The same contact email did (guest checkouts spread over many bookings). */
  velocity_contact: 40,
  /** Too many payments started from one IP address in 24 hours. */
  velocity_ip: 30,
  /** The card was issued in another country than the one the payer connected from. */
  card_country_mismatch: 30,
  /** More distinct cards than PAYMENT_RISK_MAX_CARDS on the account (or contact) in 30 days. */
  many_cards: 40,
  /** A route or country listed in PAYMENT_RISK_ROUTES / PAYMENT_RISK_COUNTRIES. */
  high_risk_route: 30,
} as const;
export type RiskSignal = keyof typeof RISK_WEIGHTS;
export const RISK_SIGNALS = Object.keys(RISK_WEIGHTS) as RiskSignal[];

export interface RiskAssessment {
  score: number;
  signals: RiskSignal[];
}

const DAY_MS = 86_400_000;

/**
 * Scores a captured card payment from signals the platform already holds (ADR-040): payment
 * velocity per account, contact and IP, card country against connection country, distinct cards
 * and listed routes. Runs inside the capture transaction; a score at or above
 * PAYMENT_RISK_REVIEW_SCORE opens a review and fulfilment waits for staff.
 */
@Injectable()
export class PaymentRiskService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async assess(tx: Tx, booking: Booking, payment: Payment, now: Date): Promise<RiskAssessment> {
    const day = new Date(now.getTime() - DAY_MS);
    const month = new Date(now.getTime() - 30 * DAY_MS);
    const signals: RiskSignal[] = [];
    // Other card payments that went through in the last day for the same owner.
    const paidSince = (owner: Prisma.BookingWhereInput) =>
      tx.payment.count({
        where: {
          id: { not: payment.id },
          kind: 'checkout',
          status: 'succeeded',
          succeededAt: { gte: day },
          booking: owner,
        },
      });
    const max = this.config.PAYMENT_RISK_MAX_PAYMENTS_PER_DAY;
    if (booking.userId && (await paidSince({ userId: booking.userId })) >= max) {
      signals.push('velocity_account');
    }
    if ((await paidSince({ contactEmailHash: booking.contactEmailHash })) >= max) {
      signals.push('velocity_contact');
    }
    if (payment.ipHash) {
      const started = await tx.payment.count({
        where: { ipHash: payment.ipHash, createdAt: { gte: day } },
      });
      if (started > this.config.PAYMENT_RISK_MAX_ATTEMPTS_PER_IP) signals.push('velocity_ip');
    }
    if (payment.cardCountry && payment.ipCountry && payment.cardCountry !== payment.ipCountry) {
      signals.push('card_country_mismatch');
    }
    if (payment.cardFingerprintHash) {
      const owner: Prisma.BookingWhereInput = booking.userId
        ? { userId: booking.userId }
        : { contactEmailHash: booking.contactEmailHash };
      const cards = await tx.payment.findMany({
        where: {
          status: 'succeeded',
          succeededAt: { gte: month },
          cardFingerprintHash: { not: null },
          booking: owner,
        },
        select: { cardFingerprintHash: true },
        distinct: ['cardFingerprintHash'],
      });
      const distinct = new Set([
        payment.cardFingerprintHash,
        ...cards.map((card) => card.cardFingerprintHash),
      ]);
      if (distinct.size > this.config.PAYMENT_RISK_MAX_CARDS) signals.push('many_cards');
    }
    if (await this.listedRoute(tx, booking.id)) signals.push('high_risk_route');
    return { score: signals.reduce((sum, signal) => sum + RISK_WEIGHTS[signal], 0), signals };
  }

  /**
   * Opens a review when the payment scores at or above the threshold and returns its id; the
   * caller then leaves the paid booking for staff instead of fulfilling it.
   */
  async holdIfRisky(tx: Tx, booking: Booking, payment: Payment, now: Date): Promise<string | null> {
    if (!this.config.PAYMENT_RISK_ENABLED || payment.kind !== 'checkout') return null;
    const { score, signals } = await this.assess(tx, booking, payment, now);
    if (score < this.config.PAYMENT_RISK_REVIEW_SCORE) return null;
    const review = await tx.paymentRiskReview.create({
      data: { bookingId: booking.id, paymentId: payment.id, score, signals },
    });
    await this.audit.record(
      {
        action: 'payment_risk.held',
        actorType: 'system',
        targetType: 'booking',
        targetId: booking.id,
        metadata: { reviewId: review.id, paymentId: payment.id, score, signals },
      },
      tx,
    );
    return review.id;
  }

  /** A flight touching a listed airport pair or country, or any trip to a listed country. */
  private async listedRoute(tx: Tx, bookingId: string): Promise<boolean> {
    const countries = new Set(this.config.PAYMENT_RISK_COUNTRIES);
    const routes = new Set(this.config.PAYMENT_RISK_ROUTES);
    if (countries.size === 0 && routes.size === 0) return false;
    const items = await tx.bookingItem.findMany({
      where: { bookingId },
      select: { payload: true },
    });
    return items.some((item) => {
      const payload = itemPayload(item);
      if (payload.kind === 'flight') {
        return payload.offer.slices.some(
          ({ origin, destination }) =>
            routes.has(`${origin.code}-${destination.code}`) ||
            routes.has(`${destination.code}-${origin.code}`) ||
            (origin.countryCode !== null && countries.has(origin.countryCode)) ||
            (destination.countryCode !== null && countries.has(destination.countryCode)),
        );
      }
      const country = tripFacts(payload)?.countryCode;
      return country !== null && country !== undefined && countries.has(country);
    });
  }
}
