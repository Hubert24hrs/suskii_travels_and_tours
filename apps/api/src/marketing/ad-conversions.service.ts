import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import { AD_CONVERSION_MAX_ATTEMPTS, money, toDecimalString } from '@suskii/shared';

import { bookingUrl } from '../bookings/booking-urls';
import { BookingsService } from '../bookings/bookings.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma, type BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { adConversions } from '../telemetry/metrics';

import { marketingAllowed } from './ad-attribution';
import {
  AdConversionsProvider,
  hashEmail,
  hashPhone,
  type ClickIds,
  type PurchaseEvent,
} from './ad-conversions.provider';
import type { adConversionRunSchema } from './marketing.schemas';

/** Paid in full: the moment a booking counts as a purchase. */
const PURCHASED: BookingStatus[] = ['PAID', 'TICKETING', 'CONFIRMED'];
const BATCH = 100;
/** A claimed row is left alone this long, so two sweeps never send the same event. */
const CLAIM_MS = 10 * 60_000;
/** Wait before the second and third sends. */
const RETRY_AFTER_MS = [15 * 60_000, 60 * 60_000];

/** Every provider configured for server-side conversions (empty: none). */
export const AD_CONVERSIONS_PROVIDERS = Symbol('AD_CONVERSIONS_PROVIDERS');

/**
 * Server-side Purchase events for ads (ADR-079).
 *
 * `AdAttribution.keep()` stores a booking's attribution when its recorded consent allows it;
 * `run()` is the worker's sweep: it claims paid bookings' rows, re-reads the consent (a visitor
 *   who turned marketing off since then sends nothing), sends to each network that has not
 *   accepted yet, retries twice, and clears the click ids once sent or given up.
 */
@Injectable()
export class AdConversionsService {
  private readonly logger = new Logger(AdConversionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    @Inject(AD_CONVERSIONS_PROVIDERS) private readonly providers: AdConversionsProvider[],
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.providers.length > 0;
  }

  async run(now = new Date()): Promise<z.infer<typeof adConversionRunSchema>> {
    const result = { sent: 0, retried: 0, failed: 0, withdrawn: 0 };
    if (!this.enabled) return result;
    const due = await this.prisma.adConversion.findMany({
      where: {
        status: 'waiting',
        nextAttemptAt: { lte: now },
        booking: { status: { in: PURCHASED } },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH,
      select: { id: true, nextAttemptAt: true },
    });
    for (const row of due) {
      const outcome = await this.process(row.id, row.nextAttemptAt, now);
      if (outcome) result[outcome] += 1;
    }
    return result;
  }

  private async process(
    id: string,
    claimedFrom: Date,
    now: Date,
  ): Promise<'sent' | 'retried' | 'failed' | 'withdrawn' | null> {
    // Claim: only the sweep that moves next_attempt_at forward goes on.
    const claim = await this.prisma.adConversion.updateMany({
      where: { id, status: 'waiting', nextAttemptAt: claimedFrom },
      data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claim.count === 0) return null;
    const row = await this.prisma.adConversion.findUniqueOrThrow({
      where: { id },
      include: {
        booking: {
          select: {
            id: true,
            totalMinor: true,
            currency: true,
            contactEncrypted: true,
            items: { select: { type: true } },
          },
        },
      },
    });

    if (!(await marketingAllowed(this.prisma, row.consentId))) {
      await this.finish(id, 'withdrawn', row.sentTo, now);
      adConversions.add(1, { network: 'all', outcome: 'withdrawn' });
      return 'withdrawn';
    }

    const pending = this.providers.filter((provider) => !row.sentTo.includes(provider.network));
    const event = this.purchaseEvent(row.booking, (row.clickIds ?? {}) as ClickIds, now);
    const settled = await Promise.allSettled(
      pending.map((provider) =>
        provider.sendPurchase(event, AbortSignal.timeout(this.config.AD_CONVERSIONS_TIMEOUT_MS)),
      ),
    );
    const sentTo = [...row.sentTo];
    settled.forEach((outcome, index) => {
      const network = pending[index]?.network ?? 'unknown';
      if (outcome.status === 'fulfilled') {
        sentTo.push(network);
        adConversions.add(1, { network, outcome: 'sent' });
      } else {
        this.logger.warn(
          { conversionId: id, network, reason: errorReason(outcome.reason) },
          'Ad conversion not accepted',
        );
      }
    });

    if (sentTo.length >= this.providers.length) {
      await this.finish(id, 'sent', sentTo, now);
      return 'sent';
    }
    const attempts = row.attempts + 1;
    const failedNetworks = pending.filter((provider) => !sentTo.includes(provider.network));
    if (attempts >= AD_CONVERSION_MAX_ATTEMPTS) {
      await this.finish(id, 'failed', sentTo, now, attempts);
      for (const provider of failedNetworks)
        adConversions.add(1, { network: provider.network, outcome: 'failed' });
      return 'failed';
    }
    await this.prisma.adConversion.update({
      where: { id },
      data: {
        sentTo,
        attempts,
        nextAttemptAt: new Date(now.getTime() + (RETRY_AFTER_MS[attempts - 1] ?? CLAIM_MS)),
      },
    });
    for (const provider of failedNetworks)
      adConversions.add(1, { network: provider.network, outcome: 'retry' });
    return 'retried';
  }

  /** Final states clear the click ids: nothing personal is kept once the event is settled. */
  private async finish(
    id: string,
    status: 'sent' | 'failed' | 'withdrawn',
    sentTo: string[],
    now: Date,
    attempts?: number,
  ): Promise<void> {
    await this.prisma.adConversion.update({
      where: { id },
      data: {
        status,
        sentTo,
        clickIds: Prisma.JsonNull,
        ...(attempts === undefined ? {} : { attempts }),
        ...(status === 'sent' ? { sentAt: now } : {}),
      },
    });
  }

  private purchaseEvent(
    booking: {
      id: string;
      totalMinor: bigint;
      currency: string;
      contactEncrypted: string;
      items: { type: string }[];
    },
    clickIds: ClickIds,
    now: Date,
  ): PurchaseEvent {
    const contact = this.bookings.contact(booking);
    // A redacted contact (deleted account) has nothing to match on.
    const redacted = contact.email.endsWith('.invalid');
    return {
      eventId: booking.id,
      eventTime: now,
      value: toDecimalString(money(booking.totalMinor, booking.currency)),
      currency: booking.currency,
      sourceUrl: bookingUrl(this.config, booking.id),
      contentIds: [...new Set(booking.items.map((item) => item.type))],
      hashedEmail: redacted ? null : hashEmail(contact.email),
      hashedPhone: redacted || !contact.phone ? null : hashPhone(contact.phone),
      clickIds,
    };
  }
}

function errorReason(reason: unknown): string {
  if (reason instanceof Error) return reason.name === 'Error' ? reason.message : reason.name;
  return 'unknown';
}
