import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import {
  DEFAULT_CURRENCY,
  agentCardSchema,
  currencyCodeSchema,
  type AgentCard,
  type CurrencyCode,
  type MoneyWire,
} from '@suskii/shared';

import type { BookingCaller } from '../../bookings/bookings.service';
import { ProblemDetailsException } from '../../common/problem-details';
import type { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../infra/prisma.service';
import { withCurrentTier } from '../../prime/prime-status';
import type { ClientContext } from '../../search/client-context';
import type { AgentGrant } from '../agent-grants';
import { AgentToolError } from '../agent-tool';

/**
 * A tool call has no traveller's request behind it, so there is no address to record: audit
 * rows written by a service a tool calls say the assistant asked, for the grant's caller.
 */
export const AGENT_REQUEST_CONTEXT: RequestContext = { ip: '0.0.0.0', userAgent: 'suskii-agent' };

/** Who a tool is for the ordinary services: always the grant's caller (ADR-101). */
@Injectable()
export class AgentToolCallers {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The pricing client the grant's caller is on the website or in the app, with the Prime tier
   * read now, so a tool shows the prices that person would see on the ordinary screens.
   */
  client(grant: AgentGrant): Promise<ClientContext> {
    return withCurrentTier(this.prisma, {
      channel: grant.channel === 'app' ? 'mobile' : grant.channel === 'web' ? 'web' : null,
      userTier: grant.userId ? 'member' : 'guest',
      userId: grant.userId,
      benefits: null,
      country: grant.country,
    });
  }

  /** The currency the conversation shows prices in: one the platform sells in. */
  currency(grant: AgentGrant): CurrencyCode {
    const parsed = currencyCodeSchema.safeParse(grant.currency);
    return parsed.success ? parsed.data : DEFAULT_CURRENCY;
  }

  /** The signed-in caller. A guest owns nothing here: `not_found`, as the API answers 404. */
  userId(grant: AgentGrant): string {
    if (!grant.userId) throw new AgentToolError('not_found');
    return grant.userId;
  }

  /** The caller as the booking services know one: by session only, never a guest token. */
  async booking(grant: AgentGrant): Promise<BookingCaller> {
    return {
      client: await this.client(grant),
      context: AGENT_REQUEST_CONTEXT,
      token: null,
      attestation: null,
    };
  }
}

const PROBLEM_CODE = /^[a-z][a-z0-9_-]{1,47}$/;

/** A reason nothing came back, as a code the model may explain: never a sentence. */
export const problemsSchema = z.array(z.string().regex(PROBLEM_CODE)).max(8);

/**
 * The codes of a refusal a service raised (`validation-failed` and each field's `date_in_past`,
 * `search-unavailable`...): fixed strings from our own code, so a model can say why a search did
 * not run. Null for anything that is not such a refusal.
 */
export function problemCodes(error: unknown): string[] | null {
  if (!(error instanceof ProblemDetailsException)) return null;
  const status = error.getStatus();
  if (status !== 503 && (status < 400 || status >= 500)) return null;
  const listed = Array.isArray(error.extensions.errors) ? error.extensions.errors : [];
  const codes = [
    error.slug,
    ...listed.flatMap((issue: unknown) =>
      typeof issue === 'object' && issue !== null && 'code' in issue ? [String(issue.code)] : [],
    ),
  ];
  return [...new Set(codes.filter((code) => PROBLEM_CODE.test(code)))].slice(0, 8);
}

/** The codes of what a Zod schema refused: its custom messages are codes (`date_in_past`). */
export function issueCodes(error: z.ZodError): string[] {
  const codes = error.issues.map((issue) =>
    PROBLEM_CODE.test(issue.message)
      ? issue.message
      : `invalid_${String(issue.path.at(-1) ?? 'input')}`,
  );
  return [...new Set(codes.filter((code) => PROBLEM_CODE.test(code)))].slice(0, 8);
}

/**
 * Runs a service call as a tool: another person's record or a missing one is `not_found`, a
 * refusal is `refused`, a service that could not answer is `failed`. Anything else is a fault
 * and stays an error the gateway reports.
 */
export async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    if (error instanceof NotFoundException) throw new AgentToolError('not_found');
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === 404) throw new AgentToolError('not_found');
      if (status === 503) throw new AgentToolError('failed');
      if (status >= 400 && status < 500) throw new AgentToolError('refused');
    }
    throw error;
  }
}

/** "6 h 45 min": a length of time as a person reads it, so a model never does the division. */
export function durationText(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "2026-12-01T10:25" to "2026-12-01 10:25": a wall time, wherever the clock is. */
export const wallTime = (local: string): string => local.replace('T', ' ').slice(0, 16);

/** "2026-11-02T13:00:00.000Z" to "2026-11-02 13:00 UTC". */
export const utcTime = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** "Lagos (LOS)", or the code alone when the catalog has no city for it. */
export const placeText = (point: { code: string; cityName: string | null }): string =>
  point.cityName ? `${point.cityName} (${point.code})` : point.code;

export const moneyOut = z.object({ amountMinor: z.number().int(), currency: z.string().length(3) });
export const cardsOut = z.array(agentCardSchema).max(6);

const cut = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
};

/**
 * A card the client draws beside the answer. The API builds it from the same records the tool
 * read, with a link inside the site only; the model never writes one. Lines hold names, codes,
 * dates and times, which read the same in every language.
 */
export function card(
  kind: AgentCard['kind'],
  title: string,
  lines: readonly (string | null | undefined)[],
  extra: { price?: MoneyWire; href?: string; ref?: AgentCard['ref']; indicative?: boolean } = {},
): AgentCard[] {
  const parsed = agentCardSchema.safeParse({
    kind,
    title: cut(title, 120),
    lines: lines
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .slice(0, 4)
      .map((line) => cut(line, 160)),
    ...extra,
  });
  // A card that does not fit the wire is left out: the answer still stands without it.
  return parsed.success ? [parsed.data] : [];
}
