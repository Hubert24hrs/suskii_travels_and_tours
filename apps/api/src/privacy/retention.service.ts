import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { REDACTED_CONTACT_PAYLOAD } from '../bookings/bookings.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { contactContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { ObjectStorage } from '../documents/object-storage';
import type { BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

/**
 * The purge rules of the daily retention sweep (ADR-039). Each table that grows with use names
 * its rule (or another job, or why it stays) in `DATA_REGISTRY`; `data-registry.spec.ts` checks
 * that every rule here is claimed by a table.
 */
export const RETENTION_RULES = [
  'sessions',
  'verification-tokens',
  'idempotency-keys',
  'booking-access-links',
  'offers',
  'webhook-events',
  'notifications',
  'search-logs',
  'newsletter-pending',
  'closed-bookings',
] as const;
export type RetentionRule = (typeof RETENTION_RULES)[number];

/** Days rows are kept after the event the rule names (closed bookings use years from config). */
export const RETENTION_DAYS = {
  /** After the session was revoked or expired (the account's session list shows live ones). */
  sessions: 30,
  /** After the email or password-reset link expired. */
  'verification-tokens': 7,
  /** After the stored response expired (24 hours after the write). */
  'idempotency-keys': 0,
  /** After the emailed booking link expired. */
  'booking-access-links': 30,
  /** After the quote expired, unless a booking was made from it. */
  offers: 30,
  /** After a processed payment webhook arrived (payloads can hold the payer's email). */
  'webhook-events': 90,
  /** The log of what was sent to whom. */
  notifications: 180,
  /** Anonymous search analytics: 13 months, for year-on-year comparisons. */
  'search-logs': 400,
  /** Newsletter sign-ups whose confirmation link was never used. */
  'newsletter-pending': 30,
} as const satisfies Record<Exclude<RetentionRule, 'closed-bookings'>, number>;

/** Bookings that will not change again: their money is settled and nothing is due. */
const CLOSED_STATUSES: BookingStatus[] = [
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'EXPIRED',
];
const REDACTED_NAME = 'REDACTED';
const DAY_MS = 86_400_000;
const BATCH = 200;

export type RetentionRun = Record<RetentionRule, number>;

/**
 * Applies the retention rules (ADR-039). Short-lived records go after their period. Closed
 * bookings keep their financial facts (amounts, statuses, ledger) for
 * FINANCIAL_RECORDS_RETENTION_YEARS after their last change; then the personal data still on
 * them is cleared: contact, passenger names and documents, stored files and staff notes. The
 * append-only audit log and ledger hold no personal values and stay. Idempotent: a second run
 * finds nothing.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(now = new Date()): Promise<RetentionRun> {
    const before = (rule: keyof typeof RETENTION_DAYS) =>
      new Date(now.getTime() - RETENTION_DAYS[rule] * DAY_MS);
    const counts = (result: { count: number }) => result.count;
    const run: RetentionRun = {
      sessions: counts(
        await this.prisma.session.deleteMany({
          where: {
            OR: [
              { revokedAt: { lt: before('sessions') } },
              { expiresAt: { lt: before('sessions') } },
            ],
          },
        }),
      ),
      'verification-tokens': counts(
        await this.prisma.verificationToken.deleteMany({
          where: { expiresAt: { lt: before('verification-tokens') } },
        }),
      ),
      'idempotency-keys': counts(
        await this.prisma.idempotencyKey.deleteMany({
          where: { expiresAt: { lt: before('idempotency-keys') } },
        }),
      ),
      'booking-access-links': counts(
        await this.prisma.bookingAccessLink.deleteMany({
          where: { expiresAt: { lt: before('booking-access-links') } },
        }),
      ),
      offers: counts(
        await this.prisma.offer.deleteMany({
          where: { expiresAt: { lt: before('offers') }, bookingItems: { none: {} } },
        }),
      ),
      'webhook-events': counts(
        await this.prisma.webhookEvent.deleteMany({
          where: { receivedAt: { lt: before('webhook-events') }, processedAt: { not: null } },
        }),
      ),
      notifications: counts(
        await this.prisma.notification.deleteMany({
          where: { createdAt: { lt: before('notifications') } },
        }),
      ),
      'search-logs': counts(
        await this.prisma.searchLog.deleteMany({
          where: { occurredAt: { lt: before('search-logs') } },
        }),
      ),
      'newsletter-pending': counts(
        await this.prisma.newsletterSubscription.deleteMany({
          where: { status: 'pending', createdAt: { lt: before('newsletter-pending') } },
        }),
      ),
      'closed-bookings': await this.anonymiseClosedBookings(now),
    };
    await this.audit.record({
      action: 'retention.swept',
      actorType: 'system',
      metadata: { ...run },
    });
    return run;
  }

  /** Clears the personal data left on bookings closed for longer than the financial period. */
  private async anonymiseClosedBookings(now: Date): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - this.config.FINANCIAL_RECORDS_RETENTION_YEARS);
    let total = 0;
    for (;;) {
      const due = await this.prisma.booking.findMany({
        where: { status: { in: CLOSED_STATUSES }, updatedAt: { lt: cutoff }, anonymisedAt: null },
        select: { id: true, documents: { select: { storageKey: true } } },
        orderBy: { updatedAt: 'asc' },
        take: BATCH,
      });
      if (due.length === 0) return total;
      for (const booking of due) {
        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              contactEncrypted: this.encryption.encrypt(
                REDACTED_CONTACT_PAYLOAD,
                contactContext(booking.id),
              ),
              contactEmailHash: 'anonymised',
              accessTokenHash: null,
              redactedAt: now,
              anonymisedAt: now,
            },
          });
          await tx.bookingPassenger.updateMany({
            where: { bookingId: booking.id },
            data: {
              title: null,
              gender: null,
              givenNames: REDACTED_NAME,
              surname: REDACTED_NAME,
              dateOfBirth: null,
              nationality: null,
              passportEncrypted: null,
              documentHint: null,
              issuingCountry: null,
              documentExpiry: null,
              travellerId: null,
            },
          });
          await tx.bookingDocument.deleteMany({ where: { bookingId: booking.id } });
          await tx.bookingNote.deleteMany({ where: { bookingId: booking.id } });
          await tx.bookingAccessLink.deleteMany({ where: { bookingId: booking.id } });
          await tx.payment.updateMany({
            where: { bookingId: booking.id },
            data: { ipHash: null, ipCountry: null, cardCountry: null, cardFingerprintHash: null },
          });
          await tx.$executeRaw`
            UPDATE booking_items SET payload = payload - 'detailsEncrypted'
             WHERE booking_id = ${booking.id}::uuid AND payload ? 'detailsEncrypted'`;
        });
        for (const { storageKey } of booking.documents) {
          try {
            await this.storage.delete(storageKey);
          } catch (error) {
            // The row is gone, so the object is unreachable; storage lifecycle rules catch it.
            this.logger.warn({ err: error }, 'could not delete a stored booking document');
          }
        }
        total += 1;
      }
    }
  }
}
