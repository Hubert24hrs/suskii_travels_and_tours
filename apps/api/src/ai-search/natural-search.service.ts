import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  MAX_ADVANCE_DAYS,
  MAX_TRAVELLERS,
  MIN_ADULTS,
  NATURAL_SEARCH_MAX_LENGTH,
  NATURAL_SEARCH_PROBLEMS,
  addDays,
  isValidDate,
  localDate,
  type NaturalSearchDraft,
  type NaturalSearchField,
  type NaturalSearchPlace,
  type NaturalSearchRequest,
  type NaturalSearchResult,
  type NaturalSearchStatus,
} from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import {
  aiSearchCost,
  aiSearchDuration,
  aiSearchRequests,
  aiSearchTokens,
} from '../telemetry/metrics';

import { AiSearchBudget, type BudgetReservation } from './ai-search-budget';
import { LlmError, LlmProvider, NO_USAGE, type LlmUsage } from './llm-provider';
import { PlaceResolver } from './place-resolver';
import { scrubQuery } from './scrub';
import {
  TRIP_QUERY_JSON_SCHEMA,
  TRIP_QUERY_SYSTEM_PROMPT,
  tripQueryInput,
  tripQueryOutputSchema,
  type ModelPlace,
  type TripQueryOutput,
} from './trip-query';

/** Room for the model's (low-effort) thinking plus the JSON answer. */
const MAX_OUTPUT_TOKENS = 1024;
/** Conservative: fewer characters per token than most text, so the reservation covers it. */
const CHARS_PER_TOKEN = 3;

/** Who is asking: budgets are per signed-in user, or per guest address. */
export interface NaturalSearchCaller {
  userId: string | null;
  ip: string;
}

/** On when set; unset means on outside production and off in production (ADR-061). */
export function aiSearchEnabled(config: AppConfig): boolean {
  return config.AI_SEARCH_ENABLED ?? config.NODE_ENV !== 'production';
}

/**
 * Natural-language flight search (ADR-061): scrub, reserve budget, ask the model for structured
 * output, settle the cost, then check every value and resolve places through the catalog. The
 * result is a draft for the traveller's form, never a search.
 */
@Injectable()
export class NaturalSearchService {
  private readonly logger = new Logger(NaturalSearchService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly provider: LlmProvider,
    private readonly budget: AiSearchBudget,
    private readonly places: PlaceResolver,
    private readonly hmac: HmacService,
  ) {}

  status(): NaturalSearchStatus {
    return { enabled: aiSearchEnabled(this.config), maxLength: NATURAL_SEARCH_MAX_LENGTH };
  }

  async parse(
    request: NaturalSearchRequest,
    caller: NaturalSearchCaller,
    now: Date = new Date(),
  ): Promise<NaturalSearchResult> {
    if (!aiSearchEnabled(this.config)) throw new NotFoundException();
    const started = performance.now();
    const today = localDate(now, request.timeZone);
    const input = tripQueryInput(scrubQuery(request.text), today, request.timeZone);
    const promptTokens = Math.ceil(
      (TRIP_QUERY_SYSTEM_PROMPT.length + input.length) / CHARS_PER_TOKEN,
    );
    const reservation = await this.budget.reserve(
      caller.userId ?? `guest:${this.hmac.digest('ip', caller.ip)}`,
      this.budget.worstCase(promptTokens, MAX_OUTPUT_TOKENS),
      now,
    );
    if (typeof reservation === 'string') {
      this.finish('budget', started, NO_USAGE, reservation);
      throw new ProblemDetailsException(
        HttpStatus.TOO_MANY_REQUESTS,
        NATURAL_SEARCH_PROBLEMS.budgetExceeded,
        'AI search limit reached',
        'Use the search form. The limit resets tomorrow.',
      );
    }

    let output: TripQueryOutput;
    let settled = false;
    try {
      const result = await this.provider.extract({
        system: TRIP_QUERY_SYSTEM_PROMPT,
        input,
        schema: TRIP_QUERY_JSON_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      await this.settle(reservation, result.usage);
      settled = true;
      const parsed = tripQueryOutputSchema.safeParse(result.output);
      if (!parsed.success) throw new LlmError('invalid_output', result.usage);
      output = parsed.data;
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      // A timeout or lost connection may still be billed: keep the reservation for those.
      if (!settled && error.reason !== 'timeout' && error.reason !== 'unavailable') {
        await this.settle(reservation, error.usage ?? NO_USAGE);
      }
      this.finish('unavailable', started, error.usage ?? NO_USAGE, error.reason);
      throw this.unavailable();
    }

    const result = output.understood ? await this.draft(output, today) : null;
    if (!result) {
      this.finish('not_understood', started, NO_USAGE);
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        NATURAL_SEARCH_PROBLEMS.notUnderstood,
        'We could not read a flight search from that',
        'Try naming where you are flying to, or use the search form.',
      );
    }
    this.finish('parsed', started, NO_USAGE);
    return result;
  }

  /** The form draft, or null when nothing usable came out of the text. */
  async draft(output: TripQueryOutput, today: string): Promise<NaturalSearchResult | null> {
    const latest = addDays(today, MAX_ADVANCE_DAYS);
    const inRange = (date: string | null, earliest = today): string =>
      date && isValidDate(date) && date >= earliest && date <= latest ? date : '';
    const resolved = new Map<string, NaturalSearchPlace>();
    const resolve = async (place: ModelPlace | null): Promise<string> => {
      const found = place ? await this.places.resolve(place) : null;
      if (!found) return '';
      resolved.set(found.code, found);
      return found.code;
    };

    const legs = await Promise.all(
      output.legs.map(async (leg) => ({
        origin: await resolve(leg.from),
        destination: await resolve(leg.to),
        departureDate: inRange(leg.date),
      })),
    );
    const tripType =
      output.tripType ??
      (legs.length > 1 ? 'multi_city' : output.returnDate ? 'round_trip' : 'one_way');
    const first = legs[0] ?? { origin: '', destination: '', departureDate: '' };
    const returnDate =
      tripType === 'round_trip' ? inRange(output.returnDate, first.departureDate || today) : '';
    const departureMonth =
      first.departureDate === '' ? monthInRange(output.departureMonth, today, latest) : null;

    const draft: NaturalSearchDraft = {
      tripType,
      origin: tripType === 'multi_city' ? '' : first.origin,
      destination: tripType === 'multi_city' ? '' : first.destination,
      departureDate: tripType === 'multi_city' ? '' : first.departureDate,
      returnDate,
      legs: tripType === 'multi_city' ? legs : [],
      travellers: travellers(output),
      cabinClass: output.cabinClass ?? 'economy',
      directOnly: output.directOnly,
      flexibleDates: output.flexibleDates,
    };

    const missing: NaturalSearchField[] = [];
    if (tripType === 'multi_city') {
      const complete = legs.filter((leg) => leg.origin && leg.destination && leg.departureDate);
      if (legs.length < 2 || complete.length < legs.length) missing.push('legs');
      if (!legs.some((leg) => leg.origin || leg.destination)) return null;
    } else {
      if (!draft.origin) missing.push('origin');
      if (!draft.destination) missing.push('destination');
      if (!draft.departureDate) missing.push('departureDate');
      if (tripType === 'round_trip' && !draft.returnDate) missing.push('returnDate');
      if (!draft.origin && !draft.destination) return null;
    }
    return { draft, places: [...resolved.values()], departureMonth, missing };
  }

  private async settle(reservation: BudgetReservation, usage: LlmUsage): Promise<void> {
    const cost = this.budget.cost(usage);
    await this.budget.settle(reservation, cost);
    aiSearchCost.add(cost, { provider: this.provider.name });
    aiSearchTokens.add(usage.inputTokens, { kind: 'input' });
    aiSearchTokens.add(usage.outputTokens, { kind: 'output' });
    aiSearchTokens.add(usage.cacheReadTokens, { kind: 'cache_read' });
    aiSearchTokens.add(usage.cacheWriteTokens, { kind: 'cache_write' });
  }

  /** Metrics and a log line with the outcome only: never the traveller's text. */
  private finish(outcome: string, started: number, usage: LlmUsage, reason?: string): void {
    const ms = Math.round(performance.now() - started);
    aiSearchRequests.add(1, { outcome, ...(reason ? { reason } : {}) });
    aiSearchDuration.record(ms, { outcome });
    if (outcome === 'unavailable') {
      this.logger.warn(
        { outcome, reason, ms, outputTokens: usage.outputTokens },
        'AI search failed',
      );
    }
  }

  private unavailable(): ProblemDetailsException {
    return new ProblemDetailsException(
      HttpStatus.SERVICE_UNAVAILABLE,
      NATURAL_SEARCH_PROBLEMS.unavailable,
      'AI search is not available right now',
      'Use the search form.',
    );
  }
}

/** Counts the shared rules accept: at least one adult, infants on laps, nine travellers at most. */
function travellers(output: TripQueryOutput): NaturalSearchDraft['travellers'] {
  const clamp = (value: number | null, min: number, max: number, fallback: number): number =>
    Math.min(max, Math.max(min, value ?? fallback));
  const adults = clamp(output.adults, MIN_ADULTS, MAX_TRAVELLERS, 1);
  const infants = clamp(output.infants, 0, Math.min(adults, MAX_TRAVELLERS - adults), 0);
  const children = clamp(output.children, 0, MAX_TRAVELLERS - adults - infants, 0);
  return { adults, children, infants };
}

/** A YYYY-MM month that has days on or after today and on or before the latest bookable day. */
function monthInRange(month: string | null, today: string, latest: string): string | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return month >= today.slice(0, 7) && month <= latest.slice(0, 7) ? month : null;
}
