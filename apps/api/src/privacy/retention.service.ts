import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { REDACTED_CONTACT_PAYLOAD } from '../bookings/bookings.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { contactContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';
import { ObjectStorage } from '../documents/object-storage';
import type { BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { redactCarsBooking } from './cars-redaction';

/**
 * The purge rules of the daily retention sweep (ADR-039). Each table that grows with use names
 * its rule (or another job, or why it stays) in `DATA_REGISTRY`; `data-registry.spec.ts` checks
 * that every rule here is claimed by a table.
 */
export const RETENTION_RULES = [
  'sessions',
  'device-credentials',
  'verification-tokens',
  'idempotency-keys',
  'booking-access-links',
  'offers',
  'webhook-events',
  'notifications',
  'search-logs',
  'newsletter-pending',
  'cookie-consents',
  'closed-bookings',
  // Cars (ADR-049 to ADR-053).
  'bus-seat-holds',
  'ticket-scans',
  'ride-offers',
  'ride-location-pings',
  'ride-locations',
  'ride-share-links',
  'safety-incidents',
  'driver-documents',
  'driver-payouts',
  'reconciliation-discrepancies',
  'rental-licences',
  'rental-photos',
  // Partner supply (ADR-070).
  'partner-clicks',
  'partner-conversions',
  // Verified reviews (ADR-077).
  'rejected-reviews',
  // Company invitations (ADR-078).
  'company-invitations',
  // Server-side ad conversions (ADR-079).
  'ad-conversions',
] as const;
export type RetentionRule = (typeof RETENTION_RULES)[number];

/** Days rows are kept after the event the rule names (closed bookings use years from config). */
export const RETENTION_DAYS = {
  /** After the session was revoked or expired (the account's session list shows live ones). */
  sessions: 30,
  /** After fingerprint sign-in was turned off for the phone (ADR-067). */
  'device-credentials': 30,
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
  /** Cookie choices: a year in force plus a year to answer questions about them (ADR-042). */
  'cookie-consents': 730,
  /** After the hold lapsed: enough to answer disputes about a lost seat. */
  'bus-seat-holds': 30,
  /** Boarding scans: a year, for duplicate-boarding and fraud questions. */
  'ticket-scans': 365,
  /** Who was offered which ride: three months of dispatch history. */
  'ride-offers': 90,
  /** After the link expired. */
  'ride-share-links': 30,
  /** After the incident was resolved: a two-year safety record. */
  'safety-incidents': 730,
  /** Superseded or rejected driver documents, and every document of a rejected application. */
  'driver-documents': 90,
  /** After the car came back or the rental ended without one: the licence served its purpose. */
  'rental-licences': 30,
  /** Outbound partner clicks: 13 months, long enough for a network to report late bookings. */
  'partner-clicks': 400,
  /** After a moderator rejected the review: long enough to answer the traveller about it. */
  'rejected-reviews': 90,
  /** After the invitation expired (7 days after it was sent), used or not. */
  'company-invitations': 30,
  /** After the booking was made: long enough to send, retry and answer a question about it. */
  'ad-conversions': 30,
} as const satisfies Record<
  Exclude<
    RetentionRule,
    | 'closed-bookings'
    | 'ride-location-pings'
    | 'ride-locations'
    | 'driver-payouts'
    | 'reconciliation-discrepancies'
    | 'rental-photos'
    | 'partner-conversions'
  >,
  number
>;

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

const daysBefore = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);
const yearsBefore = (now: Date, years: number): Date => {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
};

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
      'device-credentials': counts(
        await this.prisma.deviceCredential.deleteMany({
          where: { revokedAt: { lt: before('device-credentials') } },
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
      'cookie-consents': counts(
        await this.prisma.cookieConsent.deleteMany({
          where: { createdAt: { lt: before('cookie-consents') } },
        }),
      ),
      'closed-bookings': await this.anonymiseClosedBookings(now),
      'bus-seat-holds': counts(
        await this.prisma.busSeatHold.deleteMany({
          where: { expiresAt: { lt: before('bus-seat-holds') } },
        }),
      ),
      'ticket-scans': counts(
        await this.prisma.busTicketScan.deleteMany({
          where: { createdAt: { lt: before('ticket-scans') } },
        }),
      ),
      'ride-offers': counts(
        await this.prisma.rideOffer.deleteMany({
          where: { createdAt: { lt: before('ride-offers') }, status: { not: 'open' } },
        }),
      ),
      'ride-location-pings': counts(
        await this.prisma.rideLocationPing.deleteMany({
          where: { createdAt: { lt: daysBefore(now, this.config.RIDE_PING_RETENTION_DAYS) } },
        }),
      ),
      'ride-locations': await this.coarsenRideLocations(
        daysBefore(now, this.config.RIDE_PING_RETENTION_DAYS),
        now,
      ),
      'ride-share-links': counts(
        await this.prisma.rideShareLink.deleteMany({
          where: { expiresAt: { lt: before('ride-share-links') } },
        }),
      ),
      'safety-incidents': counts(
        await this.prisma.safetyIncident.deleteMany({
          where: { status: 'resolved', resolvedAt: { lt: before('safety-incidents') } },
        }),
      ),
      'driver-documents': await this.pruneDriverDocuments(before('driver-documents'), now),
      'rental-licences': await this.pruneRentalLicences(before('rental-licences')),
      'rental-photos': await this.pruneRentalPhotos(
        daysBefore(now, this.config.RENTAL_PHOTO_RETENTION_DAYS),
        now,
      ),
      'driver-payouts': counts(
        await this.prisma.driverPayout.deleteMany({
          where: {
            status: { not: 'pending' },
            createdAt: { lt: yearsBefore(now, this.config.FINANCIAL_RECORDS_RETENTION_YEARS) },
          },
        }),
      ),
      'partner-clicks': counts(
        await this.prisma.partnerClick.deleteMany({
          where: { createdAt: { lt: before('partner-clicks') } },
        }),
      ),
      'rejected-reviews': counts(
        await this.prisma.review.deleteMany({
          where: { status: 'rejected', moderatedAt: { lt: before('rejected-reviews') } },
        }),
      ),
      'company-invitations': counts(
        await this.prisma.companyInvitation.deleteMany({
          where: { expiresAt: { lt: before('company-invitations') } },
        }),
      ),
      'ad-conversions': counts(
        await this.prisma.adConversion.deleteMany({
          where: { createdAt: { lt: before('ad-conversions') } },
        }),
      ),
      // Commission records are revenue: kept for the financial period after their last change.
      'partner-conversions': counts(
        await this.prisma.partnerConversion.deleteMany({
          where: {
            updatedAt: { lt: yearsBefore(now, this.config.FINANCIAL_RECORDS_RETENTION_YEARS) },
          },
        }),
      ),
      // Resolved ones only; an open discrepancy is kept until finance closes it.
      'reconciliation-discrepancies': counts(
        await this.prisma.reconciliationDiscrepancy.deleteMany({
          where: {
            status: 'resolved',
            resolvedAt: { lt: yearsBefore(now, this.config.FINANCIAL_RECORDS_RETENTION_YEARS) },
          },
        }),
      ),
    };
    await this.audit.record({
      action: 'retention.swept',
      actorType: 'system',
      metadata: { ...run },
    });
    return run;
  }

  /**
   * Finished rides keep their fare and booking, but pickup and drop-off are rounded to two
   * decimal places (about 1 km) and the planned route is cleared (ADR-053).
   */
  private async coarsenRideLocations(cutoff: Date, now: Date): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE rides
         SET pickup_lat = round(pickup_lat::numeric, 2)::float8,
             pickup_lng = round(pickup_lng::numeric, 2)::float8,
             dropoff_lat = round(dropoff_lat::numeric, 2)::float8,
             dropoff_lng = round(dropoff_lng::numeric, 2)::float8,
             polyline = '',
             locations_redacted_at = ${now}
       WHERE locations_redacted_at IS NULL
         AND status IN ('completed', 'cancelled', 'no_driver')
         AND updated_at < ${cutoff}`;
  }

  /**
   * Driver documents that no longer serve vetting: superseded or rejected ones, and every
   * document of a rejected application, once the period has passed. The row stays as metadata;
   * the bytes and the wrapped key go, so any copy of the blob is unreadable.
   */
  private async pruneDriverDocuments(cutoff: Date, now: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const due = await this.prisma.driverDocument.findMany({
        where: {
          deletedAt: null,
          OR: [
            { supersededAt: { lt: cutoff } },
            { status: 'rejected', reviewedAt: { lt: cutoff } },
            { driver: { status: 'rejected', reviewedAt: { lt: cutoff } } },
          ],
        },
        select: { id: true, storageKey: true },
        take: BATCH,
      });
      if (due.length === 0) return total;
      await this.prisma.driverDocument.updateMany({
        where: { id: { in: due.map((document) => document.id) } },
        data: { deletedAt: now, storageKey: null, wrappedKey: '' },
      });
      for (const { storageKey } of due) {
        if (!storageKey) continue;
        try {
          await this.storage.delete(storageKey);
        } catch (error) {
          this.logger.warn({ err: error }, 'could not delete a stored driver document');
        }
      }
      total += due.length;
    }
  }

  /**
   * Self-drive licences once the rental is over (returned, or released without a return): the
   * row with its encrypted number goes, and the scan is deleted.
   */
  private async pruneRentalLicences(cutoff: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const due = await this.prisma.rentalLicence.findMany({
        where: {
          reservation: {
            OR: [
              { status: 'returned', returnAt: { lt: cutoff } },
              { active: false, updatedAt: { lt: cutoff } },
            ],
          },
        },
        select: { id: true, storageKey: true },
        take: BATCH,
      });
      if (due.length === 0) return total;
      await this.prisma.rentalLicence.deleteMany({
        where: { id: { in: due.map((row) => row.id) } },
      });
      await this.deleteFiles(due.map((row) => row.storageKey));
      total += due.length;
    }
  }

  /**
   * Handover photos after the dispute window (RENTAL_PHOTO_RETENTION_DAYS after the return, or
   * after a rental that never started was released): files and keys destroyed, the immutable
   * row kept as a record that evidence existed.
   */
  private async pruneRentalPhotos(cutoff: Date, now: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const due = await this.prisma.rentalHandoverPhoto.findMany({
        where: {
          deletedAt: null,
          reservation: {
            OR: [
              { status: 'returned', returnAt: { lt: cutoff } },
              { active: false, updatedAt: { lt: cutoff } },
            ],
          },
        },
        select: { id: true, storageKey: true },
        take: BATCH,
      });
      if (due.length === 0) return total;
      await this.prisma.rentalHandoverPhoto.updateMany({
        where: { id: { in: due.map((row) => row.id) } },
        data: { storageKey: null, wrappedKey: '', deletedAt: now },
      });
      await this.deleteFiles(due.map((row) => row.storageKey));
      total += due.length;
    }
  }

  private async deleteFiles(keys: readonly (string | null)[]): Promise<void> {
    for (const key of keys) {
      if (!key) continue;
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.warn({ err: error }, 'could not delete a stored rental file');
      }
    }
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
        let carsFiles: string[] = [];
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
          // Published reviews stay, signed "Verified traveller" from now on (ADR-077).
          await tx.review.updateMany({
            where: { bookingId: booking.id },
            data: { displayName: null },
          });
          await tx.payment.updateMany({
            where: { bookingId: booking.id },
            data: { ipHash: null, ipCountry: null, cardCountry: null, cardFingerprintHash: null },
          });
          await tx.$executeRaw`
            UPDATE booking_items SET payload = payload - 'detailsEncrypted'
             WHERE booking_id = ${booking.id}::uuid AND payload ? 'detailsEncrypted'`;
          carsFiles = await redactCarsBooking(tx, booking.id);
        });
        for (const storageKey of [
          ...booking.documents.map((doc) => doc.storageKey),
          ...carsFiles,
        ]) {
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
