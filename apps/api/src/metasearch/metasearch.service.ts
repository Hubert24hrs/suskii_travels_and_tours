import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { compare, flightSearchRequestSchema, money, toWire } from '@suskii/shared';
import type { FlightSearchRequest } from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { uuidv7 } from '../common/uuid';
import type { ValidationIssue } from '../contract/contract.interceptor';
import { HmacService } from '../crypto/hmac.service';
import type { MetasearchPartner } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { consume, type WindowResult } from '../rate-limit/sliding-window';
import type { ClientContext } from '../search/client-context';
import { FlightSearchService } from '../search/flight-search.service';
import { invalidSearch } from '../search/search.errors';
import type { flightQuoteSchema } from '../search/search.schemas';
import { itineraryKey } from '../suppliers/itinerary';
import { metasearchLandings, metasearchRequests } from '../telemetry/metrics';

import { isMetasearchKey, MetasearchLinks } from './metasearch-links';
import type {
  MetasearchFlightsDto,
  MetasearchFlightsQuery,
  MetasearchLandingDto,
  MetasearchOutcome,
} from './metasearch.schemas';
import type { z } from 'zod';

type FlightQuoteDto = z.infer<typeof flightQuoteSchema>;

/** Wrong or missing keys per address before the database is asked again. */
const KEY_FAILURES_PER_MINUTE = 20;
/** Partner prices are the website's guest prices: the deep link lands on the website. */
const PARTNER_CLIENT: ClientContext = {
  channel: 'web',
  userTier: 'guest',
  userId: null,
  benefits: null,
};

export interface AuthenticatedPartner {
  partner: MetasearchPartner;
  /** The tighter of the partner's minute and day windows, for RateLimit headers. */
  window: WindowResult | null;
}

const invalidKey = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNAUTHORIZED,
    'metasearch-key-invalid',
    'A valid partner key is required',
    'Send the key from the console in the X-Api-Key header.',
  );

const limited = (window: WindowResult): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.TOO_MANY_REQUESTS,
    'rate-limited',
    'Too many requests',
    'Slow down and try again later.',
    { retryAfterSeconds: window.resetSeconds },
    { 'Retry-After': String(window.resetSeconds) },
  );

/** Query names for the request fields a partner sent flat. */
function queryPath(path: readonly PropertyKey[]): string {
  const joined = path.map(String).join('.');
  const named: Record<string, string> = {
    'slices.0.origin': 'origin',
    'slices.0.destination': 'destination',
    'slices.0.departureDate': 'departureDate',
    'slices.1.departureDate': 'returnDate',
  };
  return named[joined] ?? joined.replace(/^passengers\./, '');
}

/**
 * Metasearch partners (ADR-081): the live price API behind a partner key with per-partner
 * limits, and the landing that checks a deep link's price again and records how it held.
 */
@Injectable()
export class MetasearchService {
  private readonly logger = new Logger(MetasearchService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly hmac: HmacService,
    private readonly links: MetasearchLinks,
    private readonly search: FlightSearchService,
  ) {}

  /** The active partner behind a key, within its limits; 401 or 429 otherwise. */
  async authenticate(key: string | undefined, ip: string): Promise<AuthenticatedPartner> {
    const partner =
      key && isMetasearchKey(key)
        ? await this.prisma.metasearchPartner.findUnique({
            where: { keyHash: this.hmac.digest('metasearch-key', key) },
          })
        : null;
    if (!partner?.active) {
      // Abuse control like the per-address limits (RATE_LIMIT_ENABLED); partner limits always apply.
      const failures =
        this.config.RATE_LIMIT_ENABLED &&
        (await this.count(
          `rl:metasearch-key-ip:${this.hmac.digest('ip', ip)}`,
          KEY_FAILURES_PER_MINUTE,
          60,
        ));
      metasearchRequests.add(1, { partner: 'unknown', outcome: 'invalid' });
      if (failures && !failures.allowed) throw limited(failures);
      throw invalidKey();
    }
    let tightest: WindowResult | null = null;
    for (const [name, limit, seconds] of [
      ['minute', partner.requestsPerMinute, 60],
      ['day', partner.requestsPerDay, 86_400],
    ] as const) {
      const window = await this.count(`rl:metasearch-${name}:${partner.id}`, limit, seconds);
      if (!window) continue;
      if (!window.allowed) {
        metasearchRequests.add(1, { partner: partner.code, outcome: 'limited' });
        throw limited(window);
      }
      if (!tightest || window.remaining / window.limit < tightest.remaining / tightest.limit)
        tightest = window;
    }
    return { partner, window: tightest };
  }

  /** Cheapest itineraries first, priced for the website, each with its sealed deep link. */
  async flights(
    partner: MetasearchPartner,
    query: MetasearchFlightsQuery,
  ): Promise<MetasearchFlightsDto> {
    const request = this.request(query);
    const limit = Math.min(query.limit ?? partner.maxResults, partner.maxResults);
    const result = await this.search.priced(
      request,
      { sort: 'cheapest', currency: query.currency, limit },
      PARTNER_CLIENT,
    );
    const now = Date.now();
    metasearchRequests.add(1, { partner: partner.code, outcome: 'ok' });
    return {
      currency: result.currency,
      searchedAt: new Date(now).toISOString(),
      complete: result.status === 'complete',
      itineraries: result.offers.map((offer) => ({
        slices: offer.slices.map((slice) => ({
          origin: slice.origin.code,
          destination: slice.destination.code,
          departureLocal: slice.departureLocal,
          arrivalLocal: slice.arrivalLocal,
          durationMinutes: slice.durationMinutes,
          stops: slice.stops,
          segments: slice.segments.map((segment) => ({
            marketingCarrier: segment.marketingCarrier,
            operatingCarrier: segment.operatingCarrier,
            flightNumber: segment.flightNumber,
            origin: segment.origin.code,
            destination: segment.destination.code,
            departureLocal: segment.departureLocal,
            departureUtc: segment.departureUtc,
            arrivalLocal: segment.arrivalLocal,
            arrivalUtc: segment.arrivalUtc,
            durationMinutes: segment.durationMinutes,
            aircraft: segment.aircraft,
          })),
        })),
        cabinClass: offer.cabinClass,
        fareBrand: offer.slices[0]?.fareBrand ?? null,
        baggage: offer.baggage,
        refundable: offer.conditions.refundable,
        changeable: offer.conditions.changeable,
        total: offer.price.total,
        validUntil: offer.expiresAt,
        deepLink: this.links.href(
          {
            partnerId: partner.id,
            request,
            itinerary: itineraryKey(
              offer.slices,
              offer.slices[0]?.fareBrand ?? null,
              offer.cabinClass,
            ),
            shown: money(offer.price.total.amountMinor, offer.price.total.currency),
          },
          now,
        ),
      })),
    };
  }

  /**
   * A traveller arriving through a deep link: the same itinerary is quoted with the supplier in
   * the partner's currency and compared with the price the partner showed. The landing is
   * recorded and the quote tied to it, so a booking from it is attributed to the partner.
   */
  async land(token: string, client: ClientContext): Promise<MetasearchLandingDto> {
    const link = this.links.open(token);
    if (!link) throw new NotFoundException();
    const partner = await this.prisma.metasearchPartner.findUnique({
      where: { id: link.partnerId },
      select: { id: true, name: true, code: true },
    });
    if (!partner) throw new NotFoundException();

    let quote: FlightQuoteDto | null = null;
    if (link.fresh) {
      try {
        const offerId = await this.search.findItinerary(link.request, link.itinerary);
        if (offerId) quote = await this.search.quote(offerId, link.shown.currency, client);
      } catch (error) {
        // Past dates (400), a lost search (404) or a sold-out offer (410) mean the flight is
        // gone; a supplier outage (503) is not an outcome, so the page can try again.
        const status = error instanceof ProblemDetailsException ? error.getStatus() : null;
        const gone =
          error instanceof NotFoundException ||
          status === HttpStatus.BAD_REQUEST ||
          status === HttpStatus.GONE;
        if (!gone) throw error;
      }
    }
    const landed = quote
      ? money(quote.offer.price.total.amountMinor, quote.offer.price.total.currency)
      : null;
    const outcome: MetasearchOutcome = !link.fresh
      ? 'expired'
      : !landed
        ? 'unavailable'
        : compare(landed, link.shown) === 0
          ? 'same'
          : compare(landed, link.shown) < 0
            ? 'lower'
            : 'higher';

    const quoteId = quote?.quoteId ?? null;
    await this.prisma.$transaction(async (tx) => {
      const landing = await tx.metasearchLanding.create({
        data: {
          id: uuidv7(),
          partnerId: partner.id,
          outcome,
          shownMinor: link.shown.minor,
          landedMinor: landed?.minor ?? null,
          currency: link.shown.currency,
        },
      });
      if (quoteId)
        await tx.offer.update({
          where: { id: quoteId },
          data: { metasearchLandingId: landing.id },
        });
    });
    metasearchLandings.add(1, { partner: partner.code, outcome });
    return {
      outcome,
      partner: { name: partner.name },
      quoteId,
      shown: toWire(link.shown),
      current: landed ? toWire(landed) : null,
      offer: quote?.offer ?? null,
      request: link.request,
    };
  }

  /** The flat partner query as a search request, validated like the website's. */
  private request(query: MetasearchFlightsQuery): FlightSearchRequest {
    const outbound = {
      origin: query.origin,
      destination: query.destination,
      departureDate: query.departureDate,
    };
    const parsed = flightSearchRequestSchema.safeParse({
      slices: query.returnDate
        ? [
            outbound,
            {
              origin: query.destination,
              destination: query.origin,
              departureDate: query.returnDate,
            },
          ]
        : [outbound],
      passengers: { adults: query.adults, children: query.children, infants: query.infants },
      cabinClass: query.cabin,
      directOnly: query.directOnly,
    });
    if (parsed.success) return parsed.data;
    throw invalidSearch(
      parsed.error.issues.map((issue): ValidationIssue => ({
        location: 'query',
        path: queryPath(issue.path),
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  /** One request against a sliding window; null when Redis is unreachable (fails open). */
  private async count(key: string, limit: number, seconds: number): Promise<WindowResult | null> {
    try {
      return await consume(this.redis, key, limit, seconds);
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'Metasearch limit unavailable; allowing the request',
      );
      return null;
    }
  }
}
