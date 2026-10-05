import { Inject, Injectable } from '@nestjs/common';

import { PreferencesService } from '../accounts/preferences.service';
import { BOOKING_INCLUDE } from '../bookings/booking-presenter';
import { BookingsService, passportContext } from '../bookings/bookings.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FieldEncryption } from '../crypto/field-encryption';
import { PrismaService } from '../infra/prisma.service';

import type { ExportSection } from './data-registry';

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;
const isoDate = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
const minor = (value: bigint | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export interface DataExport {
  format: 'suskii-data-export';
  version: 1;
  generatedAt: string;
  accountId: string;
  notes: string[];
  data: Record<ExportSection, unknown>;
}

/**
 * Builds the account's data export (ADR-029): one section per `EXPORT_SECTIONS` entry, typed so a
 * new section cannot be forgotten. Secrets (password and token hashes, TOTP secrets, device
 * tokens, voucher codes), internal pricing, staff notes and other people's accounts never appear.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: FieldEncryption,
    private readonly bookings: BookingsService,
    private readonly preferences: PreferencesService,
  ) {}

  async build(userId: string, now = new Date()): Promise<DataExport> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { select: { roleKey: true } } },
    });
    const bookingRows = await this.prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: BOOKING_INCLUDE,
    });
    const bookingIds = bookingRows.map((booking) => booking.id);

    const [
      preferences,
      notificationPreferences,
      notifications,
      identities,
      sessions,
      factor,
      recoveryCodes,
      devices,
      travellers,
      payments,
      refunds,
      wallet,
      visaApplications,
      memberships,
      referrals,
      priceAlerts,
      newsletter,
      activity,
    ] = await Promise.all([
      this.preferences.get(userId),
      this.preferences.notifications(userId),
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.socialIdentity.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.session.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.mfaFactor.findUnique({ where: { userId_type: { userId, type: 'totp' } } }),
      this.prisma.mfaRecoveryCode.findMany({ where: { userId }, select: { usedAt: true } }),
      this.prisma.pushToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.traveller.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.payment.findMany({
        where: { bookingId: { in: bookingIds } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.refund.findMany({
        where: { bookingId: { in: bookingIds } },
        orderBy: { createdAt: 'asc' },
      }),
      this.wallet(userId),
      this.prisma.visaApplication.findMany({
        where: { bookingId: { in: bookingIds } },
        orderBy: { createdAt: 'asc' },
        include: {
          product: { select: { slug: true, title: true } },
          events: { orderBy: { occurredAt: 'asc' } },
          documents: { orderBy: { uploadedAt: 'asc' } },
        },
      }),
      this.prisma.primeMembership.findMany({
        where: { userId },
        orderBy: { startsAt: 'asc' },
        include: { plan: { select: { slug: true, name: true, period: true } } },
      }),
      this.referrals(userId),
      this.prisma.priceAlert.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      user.email
        ? this.prisma.newsletterSubscription.findUnique({ where: { email: user.email } })
        : null,
      this.prisma.auditLog.findMany({
        where: { actorUserId: userId },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);

    const presented = [];
    for (const booking of bookingRows) {
      presented.push({
        ...(await this.bookings.present(booking)),
        contact: this.bookings.contact(booking),
      });
    }

    const data: Record<ExportSection, unknown> = {
      profile: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: iso(user.emailVerifiedAt),
        phone: user.phone,
        phoneVerifiedAt: iso(user.phoneVerifiedAt),
        displayName: user.displayName,
        status: user.status,
        hasPassword: user.passwordHash !== null,
        roles: user.roles.map((role) => role.roleKey),
        createdAt: iso(user.createdAt),
        updatedAt: iso(user.updatedAt),
      },
      preferences,
      notificationPreferences: notificationPreferences.preferences,
      notifications: notifications.map((row) => ({
        createdAt: iso(row.createdAt),
        category: row.category,
        channel: row.channel,
        template: row.template,
        status: row.status,
        reason: row.reason,
        bookingId: row.bookingId,
      })),
      identities: identities.map((identity) => ({
        provider: identity.provider,
        email: identity.email,
        linkedAt: iso(identity.createdAt),
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        signInMethod: session.authMethod,
        userAgent: session.userAgent,
        mfaVerifiedAt: iso(session.mfaVerifiedAt),
        createdAt: iso(session.createdAt),
        lastSeenAt: iso(session.lastSeenAt),
        expiresAt: iso(session.expiresAt),
        revokedAt: iso(session.revokedAt),
        revokedReason: session.revokedReason,
      })),
      mfa: {
        authenticatorApp: factor
          ? { enrolledAt: iso(factor.createdAt), confirmedAt: iso(factor.confirmedAt) }
          : null,
        recoveryCodes: {
          total: recoveryCodes.length,
          unused: recoveryCodes.filter((code) => code.usedAt === null).length,
        },
      },
      devices: devices.map((device) => ({
        platform: device.platform,
        scope: device.scope.split(':')[0] ?? device.scope,
        registeredAt: iso(device.createdAt),
        lastSeenAt: iso(device.lastSeenAt),
      })),
      travellers: travellers.map((traveller) => ({
        id: traveller.id,
        title: traveller.title,
        gender: traveller.gender,
        givenNames: traveller.givenNames,
        surname: traveller.surname,
        dateOfBirth: isoDate(traveller.dateOfBirth),
        nationality: traveller.nationality,
        passport: traveller.passportEncrypted
          ? {
              number: this.encryption.decrypt(
                traveller.passportEncrypted,
                passportContext('traveller', traveller.id),
              ),
              issuingCountry: traveller.issuingCountry,
              expiryDate: isoDate(traveller.documentExpiry),
            }
          : null,
        createdAt: iso(traveller.createdAt),
        updatedAt: iso(traveller.updatedAt),
      })),
      bookings: presented,
      payments: payments.map((payment) => ({
        id: payment.id,
        bookingId: payment.bookingId,
        reference: payment.providerReference,
        provider: payment.provider,
        kind: payment.kind,
        status: payment.status,
        amountMinor: minor(payment.amountMinor),
        currency: payment.currency,
        method: payment.method,
        createdAt: iso(payment.createdAt),
        succeededAt: iso(payment.succeededAt),
        refundDue: payment.requiresRefund,
      })),
      refunds: refunds.map((refund) => ({
        id: refund.id,
        bookingId: refund.bookingId,
        paymentId: refund.paymentId,
        amountMinor: minor(refund.amountMinor),
        currency: refund.currency,
        destination: refund.destination,
        reason: refund.reason,
        status: refund.status,
        createdAt: iso(refund.createdAt),
        settledAt: iso(refund.settledAt),
      })),
      wallet,
      visaApplications: visaApplications.map((application) => ({
        id: application.id,
        bookingId: application.bookingId,
        product: application.product,
        applicantPosition: application.applicantPosition,
        status: application.status,
        purpose: application.purpose,
        nationality: application.nationality,
        destination: application.destination,
        travelDate: isoDate(application.travelDate),
        submittedAt: iso(application.submittedAt),
        closedAt: iso(application.closedAt),
        // Officer messages are for the customer; internal notes stay internal.
        events: application.events.map((event) => ({
          occurredAt: iso(event.occurredAt),
          kind: event.kind,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          message: event.message,
        })),
        documents: application.documents.map((document) => ({
          id: document.id,
          checklistKey: document.checklistKey,
          status: document.status,
          contentType: document.contentType,
          sizeBytes: document.sizeBytes,
          uploadedAt: iso(document.uploadedAt),
          deletedAt: iso(document.deletedAt),
        })),
      })),
      memberships: memberships.map((membership) => ({
        id: membership.id,
        plan: membership.plan,
        status: membership.status,
        startsAt: iso(membership.startsAt),
        endsAt: iso(membership.endsAt),
        benefits: membership.benefits,
        bookingId: membership.bookingId,
      })),
      referrals,
      priceAlerts: priceAlerts.map((alert) => ({
        id: alert.id,
        origin: alert.origin,
        destination: alert.destination,
        departureDate: isoDate(alert.departureDate),
        departureMonth: alert.departureMonth,
        cabinClass: alert.cabinClass,
        currency: alert.currency,
        targetMinor: minor(alert.targetMinor),
        lastPriceMinor: minor(alert.lastPriceMinor),
        lastCheckedAt: iso(alert.lastCheckedAt),
        lastNotifiedAt: iso(alert.lastNotifiedAt),
        active: alert.active,
        endsOn: isoDate(alert.endsOn),
        createdAt: iso(alert.createdAt),
      })),
      newsletter: newsletter
        ? {
            email: newsletter.email,
            status: newsletter.status,
            locale: newsletter.locale,
            whatsappPhone: newsletter.whatsappPhone,
            whatsappStatus: newsletter.whatsappStatus,
            consentVersion: newsletter.consentVersion,
            consentedAt: iso(newsletter.consentedAt),
            source: newsletter.source,
            confirmedAt: iso(newsletter.confirmedAt),
            unsubscribedAt: iso(newsletter.unsubscribedAt),
          }
        : null,
      activity: activity.map((event) => ({
        occurredAt: iso(event.occurredAt),
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        userAgent: event.userAgent,
        metadata: event.metadata,
      })),
    };

    return {
      format: 'suskii-data-export',
      version: 1,
      generatedAt: now.toISOString(),
      accountId: user.id,
      notes: [
        'Amounts are in minor units of their currency (kobo for NGN).',
        'Passenger passport numbers on bookings show their last three characters; saved travellers include the full number.',
        'Visa documents and e-tickets are listed as metadata; download them from the booking while it is available.',
        `Financial records are kept for ${this.config.FINANCIAL_RECORDS_RETENTION_YEARS} years after account deletion, with contact details removed.`,
      ],
      data,
    };
  }

  private async wallet(userId: string): Promise<unknown> {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { userId, code: { startsWith: 'wallet:' } },
      orderBy: { currency: 'asc' },
    });
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId: { in: accounts.map((account) => account.id) } },
      orderBy: { createdAt: 'asc' },
      include: { transaction: { select: { kind: true, bookingId: true } } },
    });
    return {
      balances: accounts.map((account) => ({
        currency: account.currency,
        balanceMinor: minor(account.balanceMinor),
      })),
      entries: entries.map((entry) => ({
        createdAt: iso(entry.createdAt),
        // Wallets are liabilities: a credit adds to the customer's balance.
        direction: entry.direction === 'credit' ? 'in' : 'out',
        amountMinor: minor(entry.amountMinor),
        currency: entry.currency,
        kind: entry.transaction.kind,
        bookingId: entry.transaction.bookingId,
      })),
    };
  }

  private async referrals(userId: string): Promise<unknown> {
    const [code, made, referredBy] = await Promise.all([
      this.prisma.referralCode.findUnique({ where: { userId } }),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'asc' },
        select: { status: true, createdAt: true, qualifiedAt: true, rewardedAt: true },
      }),
      this.prisma.referral.findUnique({
        where: { refereeId: userId },
        select: { status: true, createdAt: true, qualifiedAt: true, rewardedAt: true },
      }),
    ]);
    const view = (row: {
      status: string;
      createdAt: Date;
      qualifiedAt: Date | null;
      rewardedAt: Date | null;
    }) => ({
      status: row.status,
      createdAt: iso(row.createdAt),
      qualifiedAt: iso(row.qualifiedAt),
      rewardedAt: iso(row.rewardedAt),
    });
    return {
      code: code ? { code: code.code, active: code.active, createdAt: iso(code.createdAt) } : null,
      // The people referred are other accounts: only the outcome of each referral is theirs.
      referred: made.map(view),
      referredBy: referredBy ? view(referredBy) : null,
    };
  }
}
