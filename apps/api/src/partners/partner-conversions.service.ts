import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { money, parseMoney, toWire, type Money } from '@suskii/shared';

import { checkMerged } from '../admin/admin-helpers';
import { dashboardRangeCheck, DEFAULT_DASHBOARD_DAYS } from '../admin/admin-dashboard.schemas';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { safeEqual } from '../crypto/random';
import {
  Prisma,
  type PartnerConversion,
  type PartnerConversionStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { partnerConversions } from '../telemetry/metrics';

import { PARTNER_PROGRAMS } from './partner-programs';
import type { PartnerSummaryDto, PostbackInput } from './partners.schemas';

const DAY_MS = 86_400_000;
const CURRENCY = /^[A-Z]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Optimistic retries when two postbacks for one booking race. */
const ATTEMPTS = 3;

/** Network wording to our three states (ADR-070). Anything else is refused. */
const STATUS_WORDS: Record<string, PartnerConversionStatus> = {
  processing: 'pending',
  pending: 'pending',
  booked: 'pending',
  paid: 'confirmed',
  confirmed: 'confirmed',
  approved: 'confirmed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  rejected: 'cancelled',
  declined: 'cancelled',
};

/** Which reported state may replace which: pending moves on, confirmed can still be cancelled. */
const NEXT: Record<PartnerConversionStatus, readonly PartnerConversionStatus[]> = {
  pending: ['pending', 'confirmed', 'cancelled'],
  confirmed: ['confirmed', 'cancelled'],
  cancelled: [],
};

const invalid = (detail: string): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'postback-invalid',
    'Postback refused',
    detail,
  );

interface Amounts {
  priceMinor: bigint | null;
  priceCurrency: string | null;
  commissionMinor: bigint | null;
  commissionCurrency: string | null;
}

function amount(value: string | undefined, currency: string | null, field: string): Money | null {
  if (value === undefined || value === '') return null;
  if (!currency) throw invalid(`${field} needs a currency.`);
  let parsed: Money;
  try {
    parsed = parseMoney(value, currency, 'half-even');
  } catch {
    throw invalid(`${field} is not a decimal amount.`);
  }
  if (parsed.minor < 0n) throw invalid(`${field} cannot be negative.`);
  return parsed;
}

function currencyCode(value: string | undefined, field: string): string | null {
  if (value === undefined || value === '') return null;
  const code = value.toUpperCase();
  if (!CURRENCY.test(code)) throw invalid(`${field} is not an ISO 4217 code.`);
  return code;
}

/** Parses a postback's status and amounts; 400 for anything malformed, so the network retries. */
export function parsePostback(input: PostbackInput): { status: PartnerConversionStatus } & Amounts {
  const status = STATUS_WORDS[input.status.toLowerCase()];
  if (!status) throw invalid('status is not one of the documented values.');
  const currency = currencyCode(input.currency, 'currency');
  const commissionCurrency =
    currencyCode(input.commission_currency, 'commission_currency') ?? currency;
  const price = amount(input.price, currency, 'price');
  const commission = amount(input.commission, commissionCurrency, 'commission');
  return {
    status,
    priceMinor: price?.minor ?? null,
    priceCurrency: price?.currency ?? null,
    commissionMinor: commission?.minor ?? null,
    commissionCurrency: commission?.currency ?? null,
  };
}

/**
 * Conversions reported by affiliate networks (ADR-070): one row per network booking, moved
 * forward by later postbacks, never backwards. Revenue records with no personal data.
 */
@Injectable()
export class PartnerConversionsService {
  private readonly logger = new Logger(PartnerConversionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Checks the postback secret in constant time; 404 while the network has none configured. */
  authorise(network: 'travelpayouts', token: string): void {
    const secret =
      network === 'travelpayouts' ? this.config.TRAVELPAYOUTS_POSTBACK_SECRET : undefined;
    if (!secret) throw new NotFoundException();
    if (!safeEqual(token, secret)) {
      partnerConversions.add(1, { network, status: 'rejected' });
      throw new ProblemDetailsException(
        HttpStatus.UNAUTHORIZED,
        'postback-unauthorised',
        'Postback refused',
        'The postback token is not valid.',
      );
    }
  }

  async record(
    network: 'travelpayouts',
    input: PostbackInput,
    now = new Date(),
  ): Promise<{ status: PartnerConversionStatus }> {
    const parsed = parsePostback(input);
    const click =
      input.click && UUID.test(input.click)
        ? await this.prisma.partnerClick.findUnique({
            where: { id: input.click.toLowerCase() },
            select: { id: true, programId: true },
          })
        : null;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const existing = await this.prisma.partnerConversion.findUnique({
        where: { network_externalId: { network, externalId: input.id } },
      });
      if (!existing) {
        try {
          const created = await this.prisma.partnerConversion.create({
            data: {
              network,
              externalId: input.id,
              clickId: click?.id ?? null,
              programId: click?.programId ?? null,
              ...this.fields(parsed, null, now),
            },
          });
          return this.counted(network, created);
        } catch (error) {
          // Another postback for the same booking won the insert: apply this one as an update.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            continue;
          throw error;
        }
      }
      if (!NEXT[existing.status].includes(parsed.status)) {
        // Late or out-of-order news (pending after paid, anything after cancelled): acknowledged
        // so the network stops retrying, but the record keeps its later state.
        return { status: existing.status };
      }
      const updated = await this.prisma.partnerConversion.updateMany({
        where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
        data: {
          ...this.fields(parsed, existing, now),
          // A later postback can name the click when the first did not.
          ...(existing.clickId || !click ? {} : { clickId: click.id, programId: click.programId }),
        },
      });
      if (updated.count === 1) {
        partnerConversions.add(1, { network, status: parsed.status });
        return { status: parsed.status };
      }
    }
    this.logger.warn({ network }, 'postback kept racing; the network will retry');
    throw new ProblemDetailsException(
      HttpStatus.CONFLICT,
      'postback-conflict',
      'Postback not applied',
      'Retry the postback.',
    );
  }

  private fields(
    parsed: ReturnType<typeof parsePostback>,
    existing: PartnerConversion | null,
    now: Date,
  ): Pick<
    Prisma.PartnerConversionUncheckedCreateInput,
    | 'status'
    | 'priceMinor'
    | 'priceCurrency'
    | 'commissionMinor'
    | 'commissionCurrency'
    | 'confirmedAt'
    | 'cancelledAt'
  > {
    // Amounts a postback leaves out keep their earlier values.
    return {
      status: parsed.status,
      priceMinor: parsed.priceMinor ?? existing?.priceMinor ?? null,
      priceCurrency: parsed.priceCurrency ?? existing?.priceCurrency ?? null,
      commissionMinor: parsed.commissionMinor ?? existing?.commissionMinor ?? null,
      commissionCurrency: parsed.commissionCurrency ?? existing?.commissionCurrency ?? null,
      confirmedAt:
        parsed.status === 'confirmed'
          ? (existing?.confirmedAt ?? now)
          : (existing?.confirmedAt ?? null),
      cancelledAt: parsed.status === 'cancelled' ? now : null,
    };
  }

  private counted(
    network: string,
    row: Pick<PartnerConversion, 'status'>,
  ): { status: PartnerConversionStatus } {
    partnerConversions.add(1, { network, status: row.status });
    return { status: row.status };
  }

  /** Clicks, conversions and commission per programme for a period (staff reports). */
  async summary(
    query: { from?: string; to?: string },
    now = new Date(),
  ): Promise<PartnerSummaryDto> {
    const to = query.to ?? now.toISOString().slice(0, 10);
    const from =
      query.from ??
      new Date(Date.parse(to) - (DEFAULT_DASHBOARD_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
    const range = checkMerged(dashboardRangeCheck, { from, to });
    const createdAt = {
      gte: new Date(`${range.from}T00:00:00.000Z`),
      lt: new Date(Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS),
    };
    const [clicks, conversions] = await Promise.all([
      this.prisma.partnerClick.groupBy({
        by: ['programId'],
        where: { createdAt },
        _count: { _all: true },
      }),
      this.prisma.partnerConversion.groupBy({
        by: ['programId', 'status', 'commissionCurrency'],
        where: { createdAt },
        _count: { _all: true },
        _sum: { commissionMinor: true },
      }),
    ]);

    const totals = (programId: string | null) => {
      const rows = conversions.filter((row) => row.programId === programId);
      const counts = { pending: 0, confirmed: 0, cancelled: 0 };
      const sums = { confirmed: new Map<string, bigint>(), pending: new Map<string, bigint>() };
      for (const row of rows) {
        counts[row.status] += row._count._all;
        if (row.status === 'cancelled' || !row.commissionCurrency) continue;
        const bucket = sums[row.status];
        const sum = row._sum.commissionMinor ?? 0n;
        bucket.set(row.commissionCurrency, (bucket.get(row.commissionCurrency) ?? 0n) + sum);
      }
      const list = (bucket: Map<string, bigint>) =>
        [...bucket.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, minor]) => toWire(money(minor, currency)));
      return {
        conversions: counts,
        confirmedCommission: list(sums.confirmed),
        pendingCommission: list(sums.pending),
      };
    };

    return {
      range,
      programs: PARTNER_PROGRAMS.map((program) => ({
        programId: program.id,
        partnerName: program.name,
        category: program.category,
        clicks: clicks.find((row) => row.programId === program.id)?._count._all ?? 0,
        ...totals(program.id),
      })),
      unattributed: totals(null),
    };
  }
}
