import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  TRIP_COMPONENTS,
  iataCodeSchema,
  isoDateSchema,
  tripPlanSchema,
  type AgentCard,
} from '@suskii/shared';

import type { BookingDto, BookingSummaryDto } from '../../bookings/bookings.schemas';
import { BookingsService } from '../../bookings/bookings.service';
import { CatalogService } from '../../catalog/catalog.service';
import { assistantBookingFacts } from '../../support/assistant/assistant-facts';
import type { tripSchema } from '../../trips/trips.schemas';
import { TripsService } from '../../trips/trips.service';
import { agentTool, AgentToolRegistry } from '../agent-tool';

import { AgentPreparedParts } from './prepared-parts';
import {
  AGENT_REQUEST_CONTEXT,
  AgentToolCallers,
  bookingLine,
  cancelledStatuses,
  card,
  cardsOut,
  guarded,
  issueCodes,
  moneyOut,
  placeText,
  problemCodes,
  problemsSchema,
  utcTime,
} from './tool-support';

type TripDto = z.infer<typeof tripSchema>;

/**
 * A status as the outcome check reads it (ADR-107): what the records say, in the words the
 * check knows. An answer may say "confirmed", "paid", "refunded" or "cancelled" only when one of
 * these says so.
 */
const statuses = (status: BookingDto['status']) => ({
  bookingStatus: status.toLowerCase(),
  cancellationStatus: cancelledStatuses.has(status) ? 'succeeded' : 'none',
});

const bookingCard = (booking: BookingSummaryDto): AgentCard[] =>
  card(
    'booking',
    bookingLine(booking),
    [booking.endsOn ? `${booking.startsOn} \u2192 ${booking.endsOn}` : booking.startsOn],
    {
      price: booking.total,
      href: `/bookings/${booking.id}`,
      ref: { type: 'booking', id: booking.id },
    },
  );

const refundsOut = z.array(z.object({ amount: moneyOut, refundStatus: z.string() }));
const refundsOf = (booking: BookingDto): z.infer<typeof refundsOut> =>
  booking.refunds.map((refund) => ({
    amount: refund.amount,
    // "completed" is the customer's word for a refund that was sent.
    refundStatus: refund.status === 'completed' ? 'succeeded' : refund.status,
  }));

const tripOut = z.object({
  tripId: z.uuid(),
  from: z.string(),
  to: z.string(),
  departDate: z.string(),
  returnDate: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  tripState: z.string(),
  total: moneyOut,
  stillToPay: moneyOut,
  parts: z.array(
    z.object({
      part: z.enum(TRIP_COMPONENTS),
      partState: z.string(),
      bookingStatus: z.string(),
      cancellationStatus: z.string(),
      bookingId: z.uuid(),
      what: z.string(),
      stillToPay: moneyOut,
      priceChangedAndWaitsForConsent: z.boolean(),
    }),
  ),
  partsNotChosenYet: z.array(z.enum(TRIP_COMPONENTS)),
});

const tripOf = (trip: TripDto): z.infer<typeof tripOut> => ({
  tripId: trip.id,
  from: placeText(trip.plan.origin),
  to: placeText(trip.plan.destination),
  departDate: trip.plan.departDate,
  returnDate: trip.plan.returnDate,
  adults: trip.plan.adults,
  children: trip.plan.children,
  tripState: trip.state,
  total: trip.total,
  stillToPay: trip.due,
  parts: trip.parts.map((part) => ({
    part: part.component,
    partState: part.state,
    ...statuses(part.status),
    bookingId: part.booking.id,
    what: bookingLine(part.booking),
    stillToPay: part.due,
    priceChangedAndWaitsForConsent: part.priceChange !== null,
  })),
  partsNotChosenYet: trip.missing,
});

const tripCard = (trip: TripDto): AgentCard[] =>
  card(
    'trip',
    `${trip.plan.origin.cityName ?? trip.plan.origin.code} \u2192 ${trip.plan.destination.cityName ?? trip.plan.destination.code}`,
    [`${trip.plan.departDate} \u2192 ${trip.plan.returnDate}`],
    { price: trip.total, href: `/trips/${trip.id}`, ref: { type: 'trip', id: trip.id } },
  );

/**
 * The signed-in traveller's own bookings, payments and trips (scope `account`). Every read goes
 * through the service that owns the record, as the grant's caller: another person's booking or
 * trip does not exist here. Nothing a model reads holds a name, a contact detail, a document, a
 * ticket number, a voucher or confirmation code, a booking reference or a payment link; the
 * cards name the record by id, and the client draws it from the traveller's own data.
 */
@Injectable()
export class AccountTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly bookings: BookingsService,
    private readonly trips: TripsService,
    private readonly catalog: CatalogService,
    private readonly prepared: AgentPreparedParts,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'bookings.list',
        description:
          "The signed-in traveller's own bookings, newest first: what each is, its dates, its status and its total. Use the bookingId with bookings.get for the details of one.",
        tier: 'read',
        scope: 'account',
        agents: ['bookings', 'payments', 'support', 'disruption', 'trip_builder'],
        input: z.object({ limit: z.number().int().min(1).max(10).default(5) }),
        output: z.object({
          shown: z.number().int(),
          thereAreMore: z.boolean(),
          bookings: z.array(
            z.object({
              bookingId: z.uuid(),
              kind: z.string(),
              what: z.string(),
              startsOn: z.string(),
              endsOn: z.string().nullable(),
              bookingStatus: z.string(),
              cancellationStatus: z.string(),
              total: moneyOut,
            }),
          ),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const page = await this.bookings.listForUser(this.callers.userId(grant), {
            limit: input.limit,
          });
          return {
            shown: page.bookings.length,
            thereAreMore: page.nextCursor !== null,
            bookings: page.bookings.map((booking) => ({
              bookingId: booking.id,
              kind: booking.vertical,
              what: bookingLine(booking),
              startsOn: booking.startsOn,
              endsOn: booking.endsOn,
              ...statuses(booking.status),
              total: booking.total,
            })),
            cards: page.bookings.slice(0, 6).flatMap(bookingCard),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'bookings.get',
        description:
          "One of the signed-in traveller's own bookings: its status, what was paid and what is due, the trip itself (places, local times, bags, room, cancellation terms), open airline changes, documents ready and refunds. Quote only what the facts say; the booking page holds the tickets and the actions.",
        tier: 'read',
        scope: 'account',
        agents: ['bookings', 'payments', 'support', 'disruption', 'trip_builder'],
        input: z.object({ bookingId: z.uuid() }),
        output: z.object({
          bookingId: z.uuid(),
          kind: z.string(),
          bookingStatus: z.string(),
          cancellationStatus: z.string(),
          total: moneyOut,
          paid: moneyOut,
          dueNow: moneyOut.nullable(),
          refunds: refundsOut,
          canBeCancelledOnline: z.boolean(),
          airlineChangedTheFlight: z.boolean(),
          fullRefundOffered: z.boolean(),
          facts: z.array(z.object({ key: z.string(), text: z.string() })).max(40),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          this.callers.userId(grant);
          const booking = await guarded(async () =>
            this.bookings.get(input.bookingId, await this.callers.booking(grant)),
          );
          const change = booking.scheduleChange?.status === 'open' ? booking.scheduleChange : null;
          return {
            bookingId: booking.id,
            kind: booking.vertical,
            ...statuses(booking.status),
            total: booking.price.total,
            paid: booking.paid,
            dueNow: booking.amountDue,
            refunds: refundsOf(booking),
            canBeCancelledOnline: booking.flightCancellable || booking.cancellation !== null,
            airlineChangedTheFlight: change !== null,
            fullRefundOffered: Boolean(change?.refundOffer),
            facts: assistantBookingFacts(booking).slice(0, 40),
            cards: card('booking', booking.vertical, [], {
              price: booking.price.total,
              href: `/bookings/${booking.id}`,
              ref: { type: 'booking', id: booking.id },
            }),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'payments.options',
        description:
          "How one of the signed-in traveller's own bookings stands for payment: paid, due now and by when, the payment methods on offer, reserving now and paying later, installments with their dates, the payment plan in force, the wallet balance and refunds. You never take a payment: the traveller pays on the booking page.",
        tier: 'read',
        scope: 'account',
        agents: ['payments', 'bookings', 'support'],
        input: z.object({ bookingId: z.uuid() }),
        output: z.object({
          bookingId: z.uuid(),
          bookingStatus: z.string(),
          cancellationStatus: z.string(),
          total: moneyOut,
          paid: moneyOut,
          dueNow: moneyOut.nullable(),
          payBy: z.string().nullable(),
          waitsForCompanyApproval: z.boolean(),
          lastPaymentStatus: z.string(),
          methods: z.array(z.string()),
          reserveNowPayLater: z.object({ payBy: z.string(), total: moneyOut }).nullable(),
          installmentsOnOffer: z
            .object({
              totalWithFee: moneyOut,
              fee: moneyOut,
              lastPaymentBy: z.string(),
              graceHours: z.number().int(),
              payments: z.array(z.object({ due: z.string(), amount: moneyOut })).max(12),
            })
            .nullable(),
          planInForce: z
            .object({
              kind: z.string(),
              planStatus: z.string(),
              graceHours: z.number().int(),
              payments: z
                .array(z.object({ due: z.string(), amount: moneyOut, paymentStatus: z.string() }))
                .max(12),
            })
            .nullable(),
          walletBalance: moneyOut.nullable(),
          refunds: refundsOut,
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          this.callers.userId(grant);
          const booking = await guarded(async () =>
            this.bookings.get(input.bookingId, await this.callers.booking(grant)),
          );
          const options = booking.paymentOptions;
          const plan = booking.paymentPlan;
          return {
            bookingId: booking.id,
            ...statuses(booking.status),
            total: booking.price.total,
            paid: booking.paid,
            dueNow: booking.amountDue,
            payBy: booking.paymentDeadline ? utcTime(booking.paymentDeadline) : null,
            waitsForCompanyApproval: booking.company?.approvalStatus === 'pending',
            lastPaymentStatus: booking.payment?.status ?? 'none',
            methods: options?.methods.map((option) => option.method) ?? [],
            reserveNowPayLater: options?.hold
              ? { payBy: utcTime(options.hold.deadline), total: options.hold.total }
              : null,
            installmentsOnOffer: options?.installments
              ? {
                  totalWithFee: options.installments.total,
                  fee: options.installments.fee,
                  lastPaymentBy: utcTime(options.installments.deadline),
                  graceHours: options.installments.graceHours,
                  payments: options.installments.schedule.slice(0, 12).map((payment) => ({
                    due: utcTime(payment.dueAt),
                    amount: payment.amount,
                  })),
                }
              : null,
            planInForce: plan
              ? {
                  kind: plan.kind,
                  planStatus: plan.status,
                  graceHours: plan.graceHours,
                  payments: plan.installments.slice(0, 12).map((payment) => ({
                    due: utcTime(payment.dueAt),
                    amount: payment.amount,
                    paymentStatus: payment.status === 'paid' ? 'succeeded' : payment.status,
                  })),
                }
              : null,
            walletBalance: options?.wallet ?? null,
            refunds: refundsOf(booking),
            cards: card('booking', booking.vertical, [], {
              ...(booking.amountDue ? { price: booking.amountDue } : {}),
              href: `/bookings/${booking.id}`,
              ref: { type: 'booking', id: booking.id },
            }),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'trips.list',
        description:
          "The signed-in traveller's own combined trips (a flight, a stay, a car, a transfer and insurance paid once), newest first, with each part, its state and what is still to pay.",
        tier: 'read',
        scope: 'account',
        agents: ['trip_builder', 'bookings', 'payments'],
        input: z.object({ limit: z.number().int().min(1).max(6).default(4) }),
        output: z.object({ shown: z.number().int(), trips: z.array(tripOut), cards: cardsOut }),
        run: async (input, { grant }) => {
          const { trips } = await this.trips.list(this.callers.userId(grant));
          const shown = trips.slice(0, input.limit);
          return {
            shown: shown.length,
            trips: shown.map(tripOf),
            cards: shown.flatMap(tripCard),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'trips.get',
        description:
          "One of the signed-in traveller's own combined trips: the plan, each part chosen so far with its state, the parts still to choose, the total and what one payment would charge now.",
        tier: 'read',
        scope: 'account',
        agents: ['trip_builder', 'bookings', 'payments'],
        input: z.object({ tripId: z.uuid() }),
        output: z.object({ trip: tripOut, cards: cardsOut }),
        run: async (input, { grant }) => {
          const userId = this.callers.userId(grant);
          const trip = await guarded(() => this.trips.get(input.tripId, userId));
          return { trip: tripOf(trip), cards: tripCard(trip) };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'trips.plan',
        description:
          'Start a combined trip for the signed-in traveller: places, dates, who travels and the parts they want (flight, hotel, car, transfer, insurance; one or two is fine). It books and holds nothing: the traveller chooses each part on the trip page and pays once. Use it only when the traveller asked to plan a trip and gave the places and dates.',
        tier: 'propose',
        scope: 'account',
        agents: ['trip_builder'],
        input: z.object({
          origin: iataCodeSchema.meta({ description: 'IATA code of the departure airport.' }),
          destination: iataCodeSchema.meta({ description: 'IATA code of the arrival airport.' }),
          departDate: isoDateSchema,
          returnDate: isoDateSchema,
          adults: z.number().int().min(1).max(9).default(1),
          children: z.number().int().min(0).max(8).default(0),
          parts: z
            .array(z.enum(TRIP_COMPONENTS))
            .min(1)
            .max(TRIP_COMPONENTS.length)
            .default(['flight', 'hotel']),
        }),
        output: z.object({
          problems: problemsSchema,
          trip: tripOut.nullable(),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          const userId = this.callers.userId(grant);
          const [origin, destination] = await Promise.all([
            this.catalog.airport(input.origin),
            this.catalog.airport(input.destination),
          ]);
          if (!origin || !destination) {
            return { problems: ['unknown_airport'], trip: null, cards: [] };
          }
          const plan = tripPlanSchema.safeParse({
            origin: {
              code: origin.code,
              name: origin.name,
              cityName: origin.municipality,
              countryCode: origin.countryCode,
            },
            destination: {
              code: destination.code,
              name: destination.name,
              cityName: destination.municipality,
              countryCode: destination.countryCode,
              cityId: destination.cityId,
            },
            departDate: input.departDate,
            returnDate: input.returnDate,
            adults: input.adults,
            children: input.children,
            components: [...new Set(input.parts)],
          });
          if (!plan.success) return { problems: issueCodes(plan.error), trip: null, cards: [] };
          try {
            const trip = await this.trips.create(
              userId,
              { plan: plan.data, currency: grant.currency },
              AGENT_REQUEST_CONTEXT,
            );
            // What the conversation prepares next goes on this trip (ADR-117).
            await this.prepared.rememberTrip(grant, trip.id);
            return { problems: [], trip: tripOf(trip), cards: tripCard(trip) };
          } catch (error) {
            // Too many open trips, mostly: said as a code, with the list a tap away.
            const problems = problemCodes(error);
            if (!problems) throw error;
            return { problems, trip: null, cards: card('link', 'Trips', [], { href: '/trips' }) };
          }
        },
      }),
    );
  }
}
