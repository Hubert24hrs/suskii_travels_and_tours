import { Injectable } from '@nestjs/common';

import { LlmError, LlmProvider, type LlmExtraction, type LlmResult } from './llm-provider';
import type { TripQueryOutput } from './trip-query';

/** Text that makes the mock fail like an unreachable provider, for fallback tests. */
export const MOCK_LLM_UNAVAILABLE = 'mock-llm-unavailable';

const CABINS: Record<string, TripQueryOutput['cabinClass']> = {
  'premium economy': 'premium_economy',
  business: 'business',
  first: 'first',
  economy: 'economy',
};

/**
 * Development and test stand-in for a language model (ADR-061; refused in production unless
 * ALLOW_MOCK_PROVIDERS). Deterministic and offline: recorded answers for known messages, else a
 * small pattern reader ("Lagos to Abuja on 2026-12-01, 2 adults, business, one way").
 */
@Injectable()
export class MockLlmProvider extends LlmProvider {
  readonly name = 'mock';
  private readonly recorded = new Map<string, unknown>();

  /** Answers `message` (as typed, case and spacing ignored) with `output`. */
  record(message: string, output: unknown): void {
    this.recorded.set(key(message), output);
  }

  extract(request: LlmExtraction): Promise<LlmResult> {
    const message = /\nMessage: ([\s\S]*)$/.exec(request.input)?.[1] ?? '';
    if (message.includes(MOCK_LLM_UNAVAILABLE)) return Promise.reject(new LlmError('unavailable'));
    const output = this.recorded.get(key(message)) ?? read(message);
    return Promise.resolve({
      output,
      // A plausible, deterministic bill: about four characters per token.
      usage: {
        inputTokens: Math.ceil(request.input.length / 4),
        outputTokens: 120,
        cacheReadTokens: Math.ceil(request.system.length / 4),
        cacheWriteTokens: 0,
      },
      model: 'mock',
    });
  }
}

const key = (message: string): string => message.trim().replace(/\s+/g, ' ').toLowerCase();

const place = (text: string | undefined): TripQueryOutput['legs'][number]['from'] => {
  const name = text?.replace(/\b(from|fly|flight|flights|a|cheap)\b/gi, '').trim();
  return name ? { name, iata: /^[A-Za-z]{3}$/.test(name) ? name.toUpperCase() : null } : null;
};

function read(message: string): TripQueryOutput {
  const lower = message.toLowerCase();
  const route =
    /(?:from\s+)?([a-z][a-z .'-]*?)\s+to\s+([a-z][a-z .'-]*?)(?=\s+(?:on|in|for|tomorrow|one|return|and|,)|[,.]|$)/i.exec(
      message,
    );
  const dates = message.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const number = (pattern: RegExp): number | null => {
    const match = pattern.exec(lower);
    return match ? Number(match[1]) : null;
  };
  const cabin = Object.keys(CABINS).find((word) => lower.includes(word));
  const returning = /\b(return|round trip|and back)\b/.test(lower) || dates.length > 1;
  if (!route) {
    return {
      understood: false,
      tripType: null,
      legs: [],
      returnDate: null,
      departureMonth: null,
      adults: null,
      children: null,
      infants: null,
      cabinClass: null,
      directOnly: false,
      flexibleDates: false,
    };
  }
  return {
    understood: true,
    tripType: returning ? 'round_trip' : 'one_way',
    legs: [{ from: place(route[1]), to: place(route[2]), date: dates[0] ?? null }],
    returnDate: returning ? (dates[1] ?? null) : null,
    departureMonth: null,
    adults: number(/(\d+)\s+adults?/),
    children: number(/(\d+)\s+(?:children|child|kids?)/),
    infants: number(/(\d+)\s+(?:infants?|bab(?:y|ies))/),
    cabinClass: cabin ? (CABINS[cabin] ?? null) : null,
    directOnly: /\b(direct|non-?stop)\b/.test(lower),
    flexibleDates: /\bflexible\b/.test(lower),
  };
}
