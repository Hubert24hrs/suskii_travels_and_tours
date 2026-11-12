import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { flightRequestToParams } from '@suskii/shared';

import type { BookingDto } from '../../bookings/bookings.schemas';
import { BookingsService } from '../../bookings/bookings.service';
import { FlightStatusService } from '../../bookings/flight-status.service';
import { agentTool, AgentToolRegistry } from '../agent-tool';

import {
  AgentToolCallers,
  card,
  cardsOut,
  cancelledStatuses,
  durationText,
  guarded,
  moneyOut,
  placeText,
  supplierText,
  utcTime,
  wallTime,
} from './tool-support';

type Slice = NonNullable<BookingDto['scheduleChange']>['updated'][number];

const flightOut = z.object({
  from: z.string(),
  to: z.string(),
  departs: z.string(),
  arrives: z.string(),
  stops: z.number().int(),
});

const flightOf = (slice: Slice): z.infer<typeof flightOut> => ({
  from: placeText(slice.origin),
  to: placeText(slice.destination),
  departs: wallTime(slice.departureLocal),
  arrives: wallTime(slice.arrivalLocal),
  stops: Math.max(0, slice.segments.length - 1),
});

/** "Lagos (LOS) \u2192 Abuja (ABV)": where a run of flights starts and ends. A card's title. */
function routeOf(
  flights: readonly { origin: Slice['origin']; destination: Slice['destination'] }[],
): string {
  const first = flights[0];
  const last = flights.at(-1);
  return first && last ? `${placeText(first.origin)} \u2192 ${placeText(last.destination)}` : '-';
}

/**
 * What the disruption concierge reads (scope `account`): how a booked flight is running today,
 * and what the airline changed on a ticketed booking. Both come from the services the booking
 * page uses, as the grant's caller; nothing here acts. Accepting a change or taking a refund
 * offer are commit tools the traveller confirms (ADR-107), and a day-of cancellation is
 * information only: a refund offer comes from the airline's change on the order (ADR-095).
 */
@Injectable()
export class DisruptionTools implements OnModuleInit {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly callers: AgentToolCallers,
    private readonly bookings: BookingsService,
    private readonly status: FlightStatusService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      agentTool({
        name: 'flights.status',
        description:
          "How the flights of one of the signed-in traveller's own bookings are running: on time, delayed (by how long, with the new times), cancelled, diverted, departed or landed, with terminal, gate and baggage belt when known. 'followed: false' means live status is not on for this booking and the booked times are shown. A cancelled flight here is information: any refund comes from changes.get, never from you.",
        tier: 'read',
        scope: 'account',
        agents: ['disruption', 'bookings', 'support'],
        input: z.object({ bookingId: z.uuid() }),
        output: z.object({
          bookingId: z.uuid(),
          followed: z.boolean(),
          flights: z
            .array(
              z.object({
                flight: z.string(),
                from: z.string(),
                to: z.string(),
                flightState: z.string(),
                scheduledDeparture: z.string(),
                scheduledArrival: z.string(),
                expectedDeparture: z.string().nullable(),
                expectedArrival: z.string().nullable(),
                departureDelay: z.string().nullable(),
                departureTerminal: z.string().nullable(),
                departureGate: z.string().nullable(),
                arrivalTerminal: z.string().nullable(),
                baggageBelt: z.string().nullable(),
                lastChecked: z.string().nullable(),
              }),
            )
            .max(12),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          this.callers.userId(grant);
          const caller = await this.callers.booking(grant);
          const status = await guarded(() => this.status.forBooking(input.bookingId, caller));
          return {
            bookingId: input.bookingId,
            followed: status.live,
            flights: status.flights.slice(0, 12).map((flight) => ({
              flight: `${supplierText(flight.carrier.name, 60)} ${flight.carrier.code}${flight.flightNumber}`,
              from: placeText(flight.origin),
              to: placeText(flight.destination),
              flightState: flight.state,
              scheduledDeparture: wallTime(flight.scheduledDepartureLocal),
              scheduledArrival: wallTime(flight.scheduledArrivalLocal),
              expectedDeparture: flight.estimatedDepartureLocal
                ? wallTime(flight.estimatedDepartureLocal)
                : null,
              expectedArrival: flight.estimatedArrivalLocal
                ? wallTime(flight.estimatedArrivalLocal)
                : null,
              departureDelay: flight.delayMinutes > 0 ? durationText(flight.delayMinutes) : null,
              departureTerminal: flight.departureTerminal,
              departureGate: flight.departureGate,
              arrivalTerminal: flight.arrivalTerminal,
              baggageBelt: flight.baggageBelt,
              lastChecked: flight.checkedAt ? utcTime(flight.checkedAt) : null,
            })),
            cards: card('booking', routeOf(status.flights), [], {
              href: `/bookings/${input.bookingId}`,
              ref: { type: 'booking', id: input.bookingId },
            }),
          };
        },
      }),
    );

    this.registry.register(
      agentTool({
        name: 'changes.get',
        description:
          "What the airline changed on one of the signed-in traveller's own ticketed bookings: the flights as booked and as they are now, whether the change is significant, whether it can be accepted online, and the full refund on offer when there is one. Read it before changes.accept or changes.take_refund_offer. With no open change it says so. The card opens the same search again, for a traveller who wants to look at other flights first; refunding and rebooking are separate steps.",
        tier: 'read',
        scope: 'account',
        agents: ['disruption', 'bookings', 'support'],
        input: z.object({ bookingId: z.uuid() }),
        output: z.object({
          bookingId: z.uuid(),
          bookingStatus: z.string(),
          cancellationStatus: z.string(),
          changeIsOpen: z.boolean(),
          changeState: z.string(),
          significant: z.boolean(),
          canBeAcceptedOnline: z.boolean(),
          fullRefundOnOffer: moneyOut.nullable(),
          noticedAt: z.string().nullable(),
          flightsAsBooked: z.array(flightOut).max(6),
          flightsNow: z.array(flightOut).max(6),
          cards: cardsOut,
        }),
        run: async (input, { grant }) => {
          this.callers.userId(grant);
          const booking = await guarded(async () =>
            this.bookings.get(input.bookingId, await this.callers.booking(grant)),
          );
          const change = booking.scheduleChange;
          const open = change?.status === 'open';
          return {
            bookingId: booking.id,
            bookingStatus: booking.status.toLowerCase(),
            cancellationStatus: cancelledStatuses.has(booking.status) ? 'succeeded' : 'none',
            changeIsOpen: open,
            changeState: change?.status ?? 'none',
            significant: change?.significant ?? false,
            canBeAcceptedOnline: open && (change?.acceptable ?? false),
            fullRefundOnOffer: open ? (change?.refundOffer?.amount ?? null) : null,
            noticedAt: change ? utcTime(change.detectedAt) : null,
            flightsAsBooked: (change?.previous ?? []).slice(0, 6).map(flightOf),
            flightsNow: (change?.updated ?? []).slice(0, 6).map(flightOf),
            cards: [
              ...card('booking', booking.vertical, [], {
                price: booking.price.total,
                href: `/bookings/${booking.id}`,
                ref: { type: 'booking', id: booking.id },
              }),
              // The booked search again (ADR-093): looking is free, and commits to nothing.
              ...(booking.flight && change
                ? card('flight', routeOf(change.previous), [], {
                    href: `/flights/search?${flightRequestToParams(booking.flight.request).toString()}`,
                  })
                : []),
            ],
          };
        },
      }),
    );
  }
}
