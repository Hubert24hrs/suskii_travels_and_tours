import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  defaultRefund,
  equals,
  fromWire,
  subtract,
  toWire,
  type Money,
  type MoneyWire,
} from '@suskii/shared';

import { BookingCancellationService } from '../../bookings/booking-cancellation.service';
import { toBookingSummary } from '../../bookings/booking-presenter';
import type { BookingDto } from '../../bookings/bookings.schemas';
import { BookingsService, type BookingCaller } from '../../bookings/bookings.service';
import { FlightCancellationService } from '../../bookings/flight-cancellation.service';
import { ScheduleChangesService } from '../../bookings/schedule-changes.service';
import {
  agentTool,
  AgentToolError,
  AgentToolRegistry,
  type AgentConfirmationDraft,
  type AgentToolContext,
} from '../agent-tool';

import {
  AgentToolCallers,
  bookingLine,
  cancelledStatuses,
  card,
  cardsOut,
  guarded,
  moneyOut,
  placeText,
  wallTime,
} from './tool-support';

type Slice = NonNullable<BookingDto['scheduleChange']>['updated'][number];

/** Statuses a traveller can still cancel from, before or after paying. */
const UNPAID = new Set<BookingDto['status']>(['PRICED', 'HELD', 'AWAITING_PAYMENT']);

const moneyOf = (wire: MoneyWire): Money => fromWire(wire);

/** A money value a card promised, read back from the stored confirmation. */
const expectedMoney = z.object({
  amountMinor: z.number().int().min(0),
  currency: z.string().length(3),
});

/** "Lagos (LOS) 2026-12-01 08:15 to Abuja (ABV) 09:30": a flight as the airline now has it. */
const sliceLine = (slice: Slice): string =>
  `${placeText(slice.origin)} ${wallTime(slice.departureLocal)} \u2192 ${placeText(slice.destination)} ${wallTime(slice.arrivalLocal)}`;

const refundsOut = z.array(z.object({ amount: moneyOut, refundStatus: z.string() }));

/** What a commit answers with: what the records hold after the traveller's tap. */
const outcomeOut = z.object({
  bookingId: z.uuid(),
  bookingStatus: z.string(),
  cancellationStatus: z.string(),
  refunds: refundsOut,
  cards: cardsOut,
});

interface Loaded {
  caller: BookingCaller;
  booking: BookingDto;
  title: string;
  dates: string[];
}

/**
 * The things a traveller may ask the assistant to do to a booking of their own (ADR-107).
 * None of them runs when an agent calls it: `prepare` checks, as the grant's caller and
 * through the ordinary service, that it can be done now, and says what the card shows; `run`
 * is called only at the traveller's own tap, with their session, and does exactly what the
 * card showed or nothing. The refund in each case is the one the booking's own terms or the
 * airline give: the assistant decides no amount and sends no money.
 */
@Injectable()
export class CommitTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly bookings: BookingsService,
    private readonly cancellation: BookingCancellationService,
    private readonly flightCancellation: FlightCancellationService,
    private readonly changes: ScheduleChangesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'bookings.cancel',
        description:
          "Asks the signed-in traveller to confirm cancelling one of their own bookings. Nothing is cancelled when you call it: the traveller gets a card with what comes back and what is kept, and only their tap cancels. Call it only after they said they want to cancel, and read bookings.get first. 'refused' means it cannot be cancelled online: offer the support team.",
        tier: 'commit',
        scope: 'account',
        agents: ['bookings', 'disruption'],
        input: z.object({ bookingId: z.uuid() }),
        output: outcomeOut,
        prepare: async (input, context) => {
          const loaded = await this.load(input.bookingId, context);
          const terms = await this.cancellationTerms(loaded);
          return {
            card: {
              kind: 'booking',
              title: loaded.title,
              lines: loaded.dates,
              amounts: terms.amounts,
              ref: { type: 'booking', id: loaded.booking.id },
            },
            expected: { refund: terms.refund ? toWire(terms.refund) : null },
            ...(terms.expiresAt ? { expiresAt: terms.expiresAt } : {}),
          };
        },
        run: async (input, context) => {
          const loaded = await this.load(input.bookingId, context);
          const promised = z
            .object({ refund: expectedMoney.nullable() })
            .safeParse(context.expected ?? {});
          // Without what the card promised there is nothing the traveller agreed to.
          if (!promised.success) throw new AgentToolError('refused');
          const refund = promised.data.refund ? moneyOf(promised.data.refund) : null;
          // A flight is held to its quote by the service; the others are checked here, so a
          // refund that changed since the card was shown cancels nothing.
          if (!loaded.booking.flightCancellable) {
            const now = this.termsNow(loaded.booking);
            if (!sameMoney(now, refund)) throw new AgentToolError('refused');
          }
          const after = await guarded(() =>
            this.cancellation.cancel(loaded.booking.id, loaded.caller, refund),
          );
          return this.outcome(after, loaded.title);
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'changes.accept',
        description:
          "Asks the signed-in traveller to confirm accepting the new flights after the airline changed a booking of theirs. Nothing is accepted when you call it: the traveller gets a card with the new times, and only their tap tells the airline. Call it only after they said they accept, and read bookings.get first. 'refused' means it cannot be accepted online: offer the support team.",
        tier: 'commit',
        scope: 'account',
        agents: ['disruption', 'bookings'],
        input: z.object({ bookingId: z.uuid() }),
        output: outcomeOut.extend({ changeStatus: z.string() }),
        prepare: async (input, context) => {
          const loaded = await this.load(input.bookingId, context);
          const change = openChange(loaded.booking);
          if (!change.acceptable) throw new AgentToolError('refused');
          return {
            card: {
              kind: 'booking',
              title: loaded.title,
              lines: change.updated.slice(0, 6).map(sliceLine),
              ref: { type: 'booking', id: loaded.booking.id },
            },
            expected: { changeId: change.id },
          };
        },
        run: async (input, context) => {
          const loaded = await this.load(input.bookingId, context);
          const promised = z.object({ changeId: z.uuid() }).safeParse(context.expected ?? {});
          if (!promised.success) throw new AgentToolError('refused');
          // The change the card showed, not a later one the traveller has not seen.
          const change = openChange(loaded.booking);
          if (change.id !== promised.data.changeId) throw new AgentToolError('refused');
          const after = await guarded(() =>
            this.changes.accept(loaded.booking.id, change.id, loaded.caller),
          );
          return {
            ...this.outcome(after, loaded.title),
            changeStatus: after.scheduleChange?.status ?? 'none',
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'changes.take_refund_offer',
        description:
          "Asks the signed-in traveller to confirm taking the full refund the airline's change entitles them to, instead of the new flights. Nothing happens when you call it: the traveller gets a card with the amount, and only their tap cancels the flights with the airline and starts the refund. Call it only when bookings.get says a full refund is offered and the traveller said they want it. 'refused' means it cannot be taken online: offer the support team.",
        tier: 'commit',
        scope: 'account',
        agents: ['disruption', 'bookings'],
        input: z.object({ bookingId: z.uuid() }),
        output: outcomeOut,
        prepare: async (input, context) => {
          const loaded = await this.load(input.bookingId, context);
          const change = openChange(loaded.booking);
          if (!change.refundOffer) throw new AgentToolError('refused');
          return {
            card: {
              kind: 'booking',
              title: loaded.title,
              lines: loaded.dates,
              amounts: [{ code: 'refund', amount: change.refundOffer.amount }],
              ref: { type: 'booking', id: loaded.booking.id },
            },
            expected: { changeId: change.id, refund: change.refundOffer.amount },
          };
        },
        run: async (input, context) => {
          const loaded = await this.load(input.bookingId, context);
          const promised = z
            .object({ changeId: z.uuid(), refund: expectedMoney })
            .safeParse(context.expected ?? {});
          if (!promised.success) throw new AgentToolError('refused');
          const change = openChange(loaded.booking);
          if (change.id !== promised.data.changeId) throw new AgentToolError('refused');
          // The service refuses an amount other than everything paid (`refund-offer-changed`).
          const after = await guarded(() =>
            this.changes.refund(
              loaded.booking.id,
              change.id,
              loaded.caller,
              moneyOf(promised.data.refund),
            ),
          );
          return this.outcome(after, loaded.title);
        },
      }),
    );
  }

  /** The traveller's own booking, as the services that will act on it see the caller. */
  private async load(bookingId: string, context: AgentToolContext): Promise<Loaded> {
    this.callers.userId(context.grant);
    const caller = await this.callers.booking(context.grant, context.request);
    const record = await guarded(() => this.bookings.load(bookingId, caller));
    const booking = await this.bookings.present(record);
    const summary = toBookingSummary(record);
    return {
      caller,
      booking,
      title: summary ? bookingLine(summary) : booking.vertical,
      dates: summary
        ? [summary.endsOn ? `${summary.startsOn} \u2192 ${summary.endsOn}` : summary.startsOn]
        : [],
    };
  }

  /**
   * What cancelling now gives back, for the card. A ticketed flight asks the airline (the
   * quote is held until it lapses, and the card with it); everything else reads the booking's
   * own terms. Anything that cannot be cancelled online is refused.
   */
  private async cancellationTerms(loaded: Loaded): Promise<{
    refund: Money | null;
    amounts: NonNullable<AgentConfirmationDraft['card']['amounts']>;
    expiresAt?: Date;
  }> {
    const { booking, caller } = loaded;
    if (booking.flightCancellable) {
      const quote = await guarded(() => this.flightCancellation.quote(booking.id, caller));
      return {
        refund: moneyOf(quote.refund),
        amounts: [
          { code: 'refund', amount: quote.refund },
          { code: 'kept', amount: quote.kept },
        ],
        expiresAt: new Date(quote.expiresAt),
      };
    }
    const refund = this.termsNow(booking);
    if (refund === undefined) throw new AgentToolError('refused');
    if (refund === null) return { refund: null, amounts: [] };
    const paid = moneyOf(booking.paid);
    return {
      refund,
      amounts: [
        { code: 'refund', amount: toWire(refund) },
        { code: 'kept', amount: toWire(subtract(paid, refund)) },
      ],
    };
  }

  /**
   * What the booking's own terms refund if it is cancelled now: null when nothing was paid,
   * undefined when it cannot be cancelled online at all.
   */
  private termsNow(booking: BookingDto): Money | null | undefined {
    if (booking.status === 'CONFIRMED') {
      return booking.cancellation ? moneyOf(booking.cancellation.refund) : undefined;
    }
    if (UNPAID.has(booking.status)) return null;
    if (booking.status === 'PARTIALLY_PAID' && booking.paymentPlan?.status === 'active') {
      // The plan's own policy: everything paid less its fee, rounded in the traveller's favour.
      return defaultRefund(moneyOf(booking.paid), booking.paymentPlan.defaultFeeBps).refund;
    }
    return undefined;
  }

  private outcome(booking: BookingDto, title: string): z.infer<typeof outcomeOut> {
    return {
      bookingId: booking.id,
      bookingStatus: booking.status.toLowerCase(),
      cancellationStatus: cancelledStatuses.has(booking.status) ? 'succeeded' : 'none',
      refunds: booking.refunds.map((refund) => ({
        amount: refund.amount,
        // "completed" is the customer's word for a refund that was sent.
        refundStatus: refund.status === 'completed' ? 'succeeded' : refund.status,
      })),
      cards: card('booking', title, [], {
        price: booking.price.total,
        href: `/bookings/${booking.id}`,
        ref: { type: 'booking', id: booking.id },
      }),
    };
  }
}

/** The change that waits for the traveller; anything else has nothing to confirm. */
function openChange(booking: BookingDto): NonNullable<BookingDto['scheduleChange']> {
  const change = booking.scheduleChange;
  if (change?.status !== 'open' || booking.status !== 'CONFIRMED') {
    throw new AgentToolError('refused');
  }
  return change;
}

function sameMoney(a: Money | null | undefined, b: Money | null): boolean {
  if (a === undefined) return false;
  if (a === null || b === null) return a === b;
  return equals(a, b);
}
