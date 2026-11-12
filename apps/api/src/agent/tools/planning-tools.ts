import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  APPROVAL_MODES,
  PASSPORT_VALIDITY_MONTHS,
  iataCodeSchema,
  isoDateSchema,
  passportValidity,
} from '@suskii/shared';

import { TravellersService } from '../../bookings/travellers.service';
import { CompaniesService, presentPolicy } from '../../companies/companies.service';
import { DealsService } from '../../deals/deals.service';
import { agentTool, AgentToolError, AgentToolRegistry } from '../agent-tool';

import { AgentToolCallers, card, cardsOut, guarded, moneyOut, note } from './tool-support';

/** What a fare trend is and is not, said with every one (ADR-080). */
export const FARE_TREND_BASIS =
  'Fares Suskii found on this route in the last 90 days, for one adult, at today’s prices. This describes what was found and is not a forecast: a fare can change at any time, and only a search shows the price you can book.';

/** Said with every passport count. The destination decides; Suskii only reminds. */
export const PASSPORT_REMINDER =
  'Many countries ask for a passport valid for at least six months after arrival, with empty pages. Check each traveller’s passport against the rule of the country you are going to before you book. This is a reminder, not a decision about entry.';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const count = z.number().int().min(0);

/**
 * What helps a traveller plan before they search or book (ADR-101): how fares on a route have
 * moved, whether the passports saved on the account last long enough, and the travel policy of
 * the company they book for. All three read; none decides anything. The fare trend is a
 * description of fares already found and is labelled so; the passport answer is counts only
 * (never a name, a number or a date of anyone's document); the policy is the caller's own
 * company's, read through their own membership.
 */
@Injectable()
export class PlanningTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly deals: DealsService,
    private readonly travellers: TravellersService,
    private readonly companies: CompaniesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'fares.trend',
        description:
          'How return fares on a route Suskii follows have moved: the lowest fare found in the last 30 days, the typical fare of the last 90, whether recent fares are lower, higher or about the same as before, and the month that is usually cheapest. It describes fares already found and is never a forecast: say so, pass on `basis`, and never tell a traveller to wait or to buy now. `followed` is false for a route with no fare history: say there is none. Use IATA airport codes from catalog.places.',
        tier: 'read',
        scope: 'search',
        agents: ['flights', 'trip_builder', 'concierge'],
        input: z
          .object({ origin: iataCodeSchema, destination: iataCodeSchema })
          .refine((value) => value.origin !== value.destination, {
            path: ['destination'],
            message: 'same_origin_destination',
          }),
        output: z.object({
          followed: z.boolean(),
          enoughHistory: z.boolean(),
          sample: z.boolean(),
          daysWithFares: count,
          lowestRecentFare: moneyOut.nullable(),
          lowestRecentFareDeparts: z.string().nullable(),
          typicalFare: moneyOut.nullable(),
          recentFaresComparedWithEarlier: z.enum(['lower', 'higher', 'steady', 'unknown']),
          usuallyCheapestMonth: z.string().nullable(),
          basis: z.string(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const none = {
            followed: false,
            enoughHistory: false,
            sample: false,
            daysWithFares: 0,
            lowestRecentFare: null,
            lowestRecentFareDeparts: null,
            typicalFare: null,
            recentFaresComparedWithEarlier: 'unknown' as const,
            usuallyCheapestMonth: null,
            basis: FARE_TREND_BASIS,
            cards: [],
          };
          const found = await this.deals.trend(
            input.origin,
            input.destination,
            this.callers.currency(grant),
            await this.callers.client(grant),
          );
          if (!found) return none;
          const { facts } = found;
          const page = card('link', `${input.origin} → ${input.destination}`, [], {
            href: `/flights/${found.slug}`,
          });
          // Whatever is said about this route's fares is read with the note: a trend, never
          // a forecast, in the traveller's language and whatever the model wrote.
          const cards = [...page, ...note('fare_trend')];
          if (!facts) return { ...none, followed: true, cards };
          const compared: 'lower' | 'higher' | 'steady' | 'unknown' = found.trend ?? 'unknown';
          return {
            followed: true,
            enoughHistory: true,
            sample: facts.sample,
            daysWithFares: facts.observedDays,
            lowestRecentFare: facts.cheapest.price,
            lowestRecentFareDeparts: facts.cheapest.departureDate,
            typicalFare: facts.typical,
            recentFaresComparedWithEarlier: compared,
            usuallyCheapestMonth:
              facts.cheapestMonth === null ? null : (MONTHS[facts.cheapestMonth - 1] ?? null),
            basis: FARE_TREND_BASIS,
            cards,
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'documents.passports',
        description:
          'Counts of the passports saved on the signed-in traveller’s account that last long enough for a trip: how many travellers are saved, how many have a passport on file, and how many of those are valid for six months after the arrival date, run out sooner, or have run out by then. Counts only: you never learn whose. Use it before an international trip is booked and pass on `reminder`. It is a reminder and never says whether anyone may enter a country. Travellers are added and changed on the travellers page.',
        tier: 'read',
        scope: 'account',
        agents: ['flights', 'tours', 'trip_builder', 'bookings', 'concierge'],
        input: z.object({
          arrivalDate: isoDateSchema.meta({ description: 'The day of arrival abroad.' }),
        }),
        output: z.object({
          savedTravellers: count,
          withPassportOnFile: count,
          passportsValidLongEnough: count,
          passportsRunningOutTooSoon: count,
          passportsRunOutByArrival: count,
          monthsOfValidityAsked: count,
          reminder: z.string(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          if (!grant.userId) throw new AgentToolError('not_found');
          const saved = await this.travellers.list(grant.userId);
          // Only the expiry date is read, and only to be counted.
          const states = saved.flatMap((traveller) =>
            traveller.document
              ? [passportValidity(traveller.document.expiryDate, input.arrivalDate)]
              : [],
          );
          const of = (state: (typeof states)[number]): number =>
            states.filter((value) => value === state).length;
          return {
            savedTravellers: saved.length,
            withPassportOnFile: states.length,
            passportsValidLongEnough: of('valid'),
            passportsRunningOutTooSoon: of('expires_soon'),
            passportsRunOutByArrival: of('expired'),
            monthsOfValidityAsked: PASSPORT_VALIDITY_MONTHS,
            reminder: PASSPORT_REMINDER,
            cards: [
              ...card('link', 'Travellers', [], { href: '/account/travellers' }),
              ...note('passport_reminder'),
            ],
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'company.policy',
        description:
          'The travel policy of the company the signed-in traveller books for: the highest cabin, the nightly hotel limit, how many days ahead to book and when a trip needs an approver. `member` is false when they belong to no company. A trip outside the policy can still be booked for the company, then waits for an approver before it can be paid; say that, and never say a trip is approved. Use it when someone plans a trip for work.',
        tier: 'read',
        scope: 'account',
        agents: ['flights', 'hotels', 'trip_builder', 'bookings', 'concierge'],
        input: z.object({}),
        output: z.object({
          member: z.boolean(),
          companyCanBook: z.boolean(),
          role: z.string().nullable(),
          highestCabin: z.string().nullable(),
          hotelNightlyLimit: moneyOut.nullable(),
          bookAtLeastDaysAhead: count.nullable(),
          needsApproval: z.enum(APPROVAL_MODES).nullable(),
          cards: cardsOut,
        }),
        run: async (_input, { grant }) => {
          const userId = grant.userId;
          if (!userId) throw new AgentToolError('not_found');
          const membership = await guarded(() => this.companies.membership(userId));
          if (!membership) {
            return {
              member: false,
              companyCanBook: false,
              role: null,
              highestCabin: null,
              hotelNightlyLimit: null,
              bookAtLeastDaysAhead: null,
              needsApproval: null,
              cards: [],
            };
          }
          const policy = presentPolicy(membership.company.policy);
          return {
            member: true,
            // A suspended company cannot book for itself (ADR-078).
            companyCanBook: membership.company.status === 'active',
            role: membership.member.role,
            highestCabin: policy.maxCabin,
            hotelNightlyLimit: policy.hotelNightlyCap,
            bookAtLeastDaysAhead: policy.minAdvanceDays,
            needsApproval: policy.approvalMode,
            cards: card('link', 'Company', [], { href: '/account/company' }),
          };
        },
      }),
    );
  }
}
