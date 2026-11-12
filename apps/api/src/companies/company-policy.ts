import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  evaluatePolicy,
  money,
  needsApproval,
  type BookingApprovalStatus,
  type CabinClass,
  type Money,
  todayIn,
  type PolicyFinding,
  type TravelPolicy,
  type TripPolicyFacts,
} from '@suskii/shared';

import type { ItemPayload } from '../bookings/booking-pricing';
import { tripFacts } from '../bookings/trip-facts';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { CompanyPolicy } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { companyApprovalRequestMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';
import type { Converter } from '../pricing/fx.service';

const DAY_MS = 86_400_000;

export const companySuspended = () =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'company-suspended',
    'Your company cannot book right now',
    'The company account is suspended. Book this trip for yourself, or contact Suskii support.',
  );

/** The stored policy row as the shared policy shape; no row means nothing applies. */
export function toTravelPolicy(row: CompanyPolicy | null): TravelPolicy {
  return {
    hotelNightlyCapMinor:
      row?.hotelNightlyCapMinor === null || row?.hotelNightlyCapMinor === undefined
        ? null
        : Number(row.hotelNightlyCapMinor),
    hotelNightlyCurrency: row?.hotelNightlyCurrency ?? null,
    maxCabin: row?.maxCabin ?? null,
    minAdvanceDays: row?.minAdvanceDays ?? null,
    approvalMode: row?.approvalMode ?? 'never',
  };
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * The zone a trip starts in, when the item names one: a flight's first origin, an in-house
 * product's own place. A stay and an assisted booking name none and are read in UTC.
 */
function startZone(payload: ItemPayload): string | null {
  if (payload.kind === 'flight') return payload.offer.slices[0]?.origin.timeZone ?? null;
  return tripFacts(payload)?.timeZone ?? null;
}

/**
 * The facts a company policy checks, from the quoted item and its priced total (ADR-078): the
 * cabin of every flight segment, a stay's price per night in the cap's currency (with the same
 * FX snapshot the price used), and the days to the first travel date, counted from today where
 * the trip starts (`todayIn`, the rule a search checks a date with). Counted from the UTC date,
 * a flight from Lagos booked in the first hour of a Lagos day was a day further off than it is,
 * and passed a minimum it had missed.
 */
export function tripPolicyFacts(
  payload: ItemPayload,
  total: Money,
  fx: Converter,
  capCurrency: string | null,
  now: Date,
): TripPolicyFacts {
  const today = todayIn(startZone(payload), now);
  const cabins: CabinClass[] =
    payload.kind === 'flight'
      ? payload.offer.slices.flatMap((slice) => slice.segments.map((segment) => segment.cabinClass))
      : [];
  let nightlyMinor: number | null = null;
  if (payload.kind === 'hotel' && capCurrency) {
    const nights = Math.max(1, daysBetween(payload.request.checkIn, payload.request.checkOut));
    const inCap = total.currency === capCurrency ? total : fx.convert(total, capCurrency, 'ceil');
    // Rounded up, so a stay a fraction over the cap is over it.
    nightlyMinor = Number((inCap.minor + BigInt(nights) - 1n) / BigInt(nights));
  }
  const start = tripFacts(payload)?.startDate ?? today;
  return { cabins, nightlyMinor, daysInAdvance: daysBetween(today, start) };
}

export interface CompanyBookingFields {
  companyId: string;
  policyFindings: PolicyFinding[];
  approvalStatus: BookingApprovalStatus;
}

/**
 * Booking for the company (ADR-078): the caller's membership, the company's state and the
 * policy's findings, evaluated on the server from the quote. Kept apart from the companies
 * service so booking creation can use it without a module cycle.
 */
@Injectable()
export class CompanyPolicyEvaluator {
  constructor(private readonly prisma: PrismaService) {}

  async forBooking(
    userId: string,
    payload: ItemPayload,
    total: Money,
    fx: Converter,
    now: Date,
  ): Promise<CompanyBookingFields> {
    const member = await this.prisma.companyMember.findUnique({
      where: { userId },
      include: { company: { include: { policy: true } } },
    });
    if (!member) throw new NotFoundException();
    if (member.company.status !== 'active') throw companySuspended();
    const policy = toTravelPolicy(member.company.policy);
    const findings = evaluatePolicy(
      policy,
      tripPolicyFacts(
        payload,
        money(total.minor, total.currency),
        fx,
        policy.hotelNightlyCurrency,
        now,
      ),
    );
    return {
      companyId: member.companyId,
      policyFindings: findings,
      approvalStatus: needsApproval(policy.approvalMode, findings) ? 'pending' : 'not_required',
    };
  }
}

/**
 * Tells a company's approvers and admins (never the booker) that a trip waits for them. Runs
 * after the booking is created; a failure is logged and never fails the booking.
 */
@Injectable()
export class CompanyApprovalNotices {
  private readonly logger = new Logger(CompanyApprovalNotices.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async requestApproval(booking: {
    id: string;
    reference: string;
    companyId: string;
    userId: string;
  }): Promise<void> {
    try {
      const [company, approvers] = await Promise.all([
        this.prisma.company.findUnique({
          where: { id: booking.companyId },
          select: { name: true },
        }),
        this.prisma.companyMember.findMany({
          where: {
            companyId: booking.companyId,
            role: { in: ['admin', 'approver'] },
            userId: { not: booking.userId },
          },
          select: { userId: true },
        }),
      ]);
      if (!company) return;
      const content = companyApprovalRequestMessage({
        reference: booking.reference,
        companyName: company.name,
        approvalsUrl: `${this.config.WEB_APP_URL.replace(/\/$/, '')}/account/company`,
        bookingId: booking.id,
      });
      for (const approver of approvers) {
        await this.notifications.notify(approver.userId, content);
      }
    } catch (error) {
      this.logger.warn(
        { bookingId: booking.id, err: (error as Error).name },
        'company approval request not sent',
      );
    }
  }
}
