import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { addDays } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { itemPayload } from '../bookings/booking-presenter';
import { contactContext, REDACTED_CONTACT_PAYLOAD } from '../bookings/bookings.service';
import { tripFacts } from '../bookings/trip-facts';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { ObjectStorage } from '../documents/object-storage';
import type { BookingStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

type Tx = Prisma.TransactionClient;

/** Why an account cannot be deleted yet (ADR-029); clients explain each one. */
export const DELETION_BLOCKERS = [
  'staff_account',
  'booking_in_progress',
  'payment_in_progress',
  'upcoming_trip',
  'visa_in_progress',
  'refund_in_progress',
  'wallet_balance',
] as const;
export type DeletionBlocker = (typeof DELETION_BLOCKERS)[number];

/** Bookings that still involve money or supplier work. */
const UNSETTLED: BookingStatus[] = [
  'HELD',
  'AWAITING_PAYMENT',
  'PARTIALLY_PAID',
  'PAID',
  'TICKETING',
  'REFUND_PENDING',
];
const OPEN_REFUNDS = ['pending_approval', 'approved', 'processing', 'needs_review'] as const;

export const tombstoneEmail = (userId: string): string => `deleted-${userId}@deleted.invalid`;

const blocked = (blockers: DeletionBlocker[]): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'account-deletion-blocked',
    'The account cannot be deleted yet',
    'Finish or cancel what is still in progress, or contact support, then try again.',
    { blockers },
  );

export interface DeletionOutcome {
  deletedAt: Date;
  retainedBookings: number;
}

/**
 * Account deletion (ADR-029): refused while something is unsettled, then one transaction turns
 * the user into a tombstone, deletes what only served the account and wipes personal fields from
 * the financial records it must keep. Files go from storage after the commit; sessions are
 * denied at once through the revocation list.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly hmac: HmacService,
    private readonly storage: ObjectStorage,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async blockers(
    userId: string,
    tx: Tx | PrismaService = this.prisma,
    now = new Date(),
  ): Promise<DeletionBlocker[]> {
    const [roles, unsettled, pendingPayments, confirmed, openVisa, openRefunds, wallets] =
      await Promise.all([
        tx.userRole.findMany({ where: { userId }, select: { roleKey: true } }),
        tx.booking.count({ where: { userId, status: { in: UNSETTLED } } }),
        tx.payment.count({
          where: { booking: { userId }, status: 'pending', expiresAt: { gt: now } },
        }),
        tx.booking.findMany({
          where: { userId, status: 'CONFIRMED' },
          select: { items: { select: { payload: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
        }),
        tx.visaApplication.count({ where: { booking: { userId }, closedAt: null } }),
        tx.refund.count({ where: { booking: { userId }, status: { in: [...OPEN_REFUNDS] } } }),
        tx.ledgerAccount.findMany({
          where: { userId, code: { startsWith: 'wallet:' } },
          select: { balanceMinor: true },
        }),
      ]);
    // A trip counts as finished the day after it ends, whatever the destination's time zone.
    const yesterday = addDays(now.toISOString().slice(0, 10), -1);
    const upcoming = confirmed.some((booking) => {
      const item = booking.items[0];
      const facts = item ? tripFacts(itemPayload(item)) : null;
      return facts !== null && facts.endDate >= yesterday;
    });
    const result: DeletionBlocker[] = [];
    if (roles.some((role) => role.roleKey !== 'customer')) result.push('staff_account');
    if (unsettled > 0) result.push('booking_in_progress');
    if (pendingPayments > 0) result.push('payment_in_progress');
    if (upcoming) result.push('upcoming_trip');
    if (openVisa > 0) result.push('visa_in_progress');
    if (openRefunds > 0) result.push('refund_in_progress');
    if (wallets.some((wallet) => wallet.balanceMinor !== 0n)) result.push('wallet_balance');
    return result;
  }

  async delete(userId: string, context: RequestContext): Promise<DeletionOutcome> {
    const now = new Date();
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        // Serialise with bookings, travellers and other per-user writes that lock the user row.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { email: true, status: true },
        });
        if (user.status === 'deleted') throw blocked([]);
        const reasons = await this.blockers(userId, tx, now);
        if (reasons.length > 0) throw blocked(reasons);

        const bookings = await tx.booking.findMany({
          where: { userId },
          select: { id: true, documents: { select: { storageKey: true } } },
        });
        const bookingIds = bookings.map((booking) => booking.id);
        const sessionIds = (
          await tx.session.findMany({ where: { userId }, select: { id: true } })
        ).map((session) => session.id);
        const visaDocuments = await tx.visaDocument.findMany({
          where: { application: { bookingId: { in: bookingIds } }, deletedAt: null },
          select: { id: true, storageKey: true },
        });

        await this.redactBookings(tx, userId, bookingIds, now);
        await tx.bookingDocument.deleteMany({ where: { bookingId: { in: bookingIds } } });
        await tx.bookingNote.deleteMany({ where: { bookingId: { in: bookingIds } } });
        await tx.visaDocument.updateMany({
          where: { id: { in: visaDocuments.map((document) => document.id) } },
          data: { storageKey: null, wrappedKey: '', fileNameEncrypted: '', deletedAt: now },
        });

        // What only served the account goes.
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.session.deleteMany({ where: { userId } });
        await tx.mfaFactor.deleteMany({ where: { userId } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
        await tx.socialIdentity.deleteMany({ where: { userId } });
        await tx.verificationToken.deleteMany({ where: { userId } });
        await tx.traveller.deleteMany({ where: { userId } });
        await tx.pushToken.deleteMany({ where: { userId } });
        await tx.userPreference.deleteMany({ where: { userId } });
        await tx.notificationPreference.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.priceAlert.deleteMany({ where: { userId } });
        await tx.referralCode.deleteMany({ where: { userId } });
        await tx.idempotencyKey.deleteMany({ where: { scope: `user:${userId}` } });
        if (user.email) {
          await tx.newsletterSubscription.deleteMany({ where: { email: user.email } });
        }

        // Purchase and reward records stay, ended and without sign-up signals.
        await tx.primeMembership.updateMany({
          where: { userId, endsAt: { gt: now } },
          data: { status: 'cancelled', endsAt: now },
        });
        await tx.referral.updateMany({
          where: { refereeId: userId },
          data: { signals: {} },
        });
        await tx.$executeRaw`
          UPDATE referrals
             SET status = 'rejected', flags = array_append(flags, 'account_deleted'),
                 updated_at = ${now}
           WHERE (referrer_id = ${userId}::uuid OR referee_id = ${userId}::uuid)
             AND status IN ('pending', 'qualified', 'review')`;

        await tx.user.update({
          where: { id: userId },
          data: {
            email: tombstoneEmail(userId),
            emailVerifiedAt: null,
            phone: null,
            phoneVerifiedAt: null,
            passwordHash: null,
            displayName: null,
            status: 'deleted',
            deletedAt: now,
          },
        });
        await this.audit.record(
          {
            action: 'user.deleted',
            actorUserId: userId,
            targetType: 'user',
            targetId: userId,
            context,
            metadata: { retainedBookings: bookingIds.length },
          },
          tx,
        );

        return {
          sessionIds,
          storageKeys: [
            ...bookings.flatMap((booking) => booking.documents.map((doc) => doc.storageKey)),
            ...visaDocuments.flatMap((document) => document.storageKey ?? []),
          ],
          retainedBookings: bookingIds.length,
        };
      },
      { timeout: 30_000 },
    );

    // Access tokens die now; the rows are already gone, so this only fills the denylist.
    for (const sessionId of outcome.sessionIds) {
      await this.sessions.revoke(sessionId, 'account_deleted');
    }
    for (const key of outcome.storageKeys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        // The rows no longer point at the file; a leftover object is unreachable, not exposed.
        this.logger.warn({ err: error }, 'could not delete a stored file of a deleted account');
      }
    }
    return { deletedAt: now, retainedBookings: outcome.retainedBookings };
  }

  /** Contact details, passports and add-on details off the bookings that must be kept. */
  private async redactBookings(
    tx: Tx,
    userId: string,
    bookingIds: string[],
    now: Date,
  ): Promise<void> {
    for (const bookingId of bookingIds) {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          contactEncrypted: this.encryption.encrypt(
            REDACTED_CONTACT_PAYLOAD,
            contactContext(bookingId),
          ),
          contactEmailHash: this.hmac.digest('booking-email', tombstoneEmail(userId)),
          redactedAt: now,
        },
      });
    }
    await tx.bookingPassenger.updateMany({
      where: { bookingId: { in: bookingIds } },
      data: {
        dateOfBirth: null,
        nationality: null,
        passportEncrypted: null,
        documentHint: null,
        issuingCountry: null,
        documentExpiry: null,
        travellerId: null,
      },
    });
    await tx.bookingAccessLink.deleteMany({ where: { bookingId: { in: bookingIds } } });
    // Risk signals are pseudonymous but still about the person (ADR-040).
    await tx.payment.updateMany({
      where: { bookingId: { in: bookingIds } },
      data: { ipHash: null, ipCountry: null, cardCountry: null, cardFingerprintHash: null },
    });
    if (bookingIds.length > 0) {
      await tx.$executeRaw`
        UPDATE booking_items SET payload = payload - 'detailsEncrypted'
         WHERE booking_id = ANY(${bookingIds}::uuid[]) AND payload ? 'detailsEncrypted'`;
    }
  }
}
