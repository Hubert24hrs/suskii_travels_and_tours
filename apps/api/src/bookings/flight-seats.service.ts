import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { seatChoiceIssue, toWire, type SeatChoice, type SeatChoiceIssue } from '@suskii/shared';

import { fromJsonValue } from '../common/json';
import { PrismaService } from '../infra/prisma.service';
import { FxService } from '../pricing/fx.service';
import { offerUnavailable } from '../search/search.errors';
import { SupplierRunner } from '../search/supplier-runner';
import { FLIGHT_SUPPLIERS } from '../suppliers/suppliers.module';
import type {
  FlightSupplier,
  SupplierFlightOffer,
  SupplierSeat,
  SupplierSeatMap,
} from '../suppliers/supplier.types';

import {
  isSeat,
  seatServiceId,
  type ExtraSelection,
  type ItemPayload,
  type SeatSelection,
} from './booking-pricing';
import type { flightSeatMapsSchema } from './bookings.schemas';

type FlightSeatMapsDto = z.infer<typeof flightSeatMapsSchema>;

/** A selection that cannot be booked, and why (the first problem found). */
export class SeatChoiceError extends Error {
  constructor(readonly issue: SeatChoiceIssue) {
    super(issue);
  }
}

const findSeat = (maps: readonly SupplierSeatMap[], flight: number, designator: string) => {
  const map = maps.find((candidate) => candidate.flight === flight);
  if (!map) return { map: null, seat: null };
  const seat =
    map.rows
      .flatMap((row) => row.sections.flat())
      .find((candidate): candidate is SupplierSeat => candidate?.designator === designator) ?? null;
  return { map, seat };
};

/** Travellers with a seat of their own: adults and children, first in the passenger list. */
export const seatedCount = (offer: SupplierFlightOffer): number =>
  offer.passengers.adults + offer.passengers.children;

/**
 * Seat selection on flights (ADR-094). The airline's seat map is the only source: it is fetched
 * for a quote to show, again when a booking is created and again right before payment, so a
 * seat is never sold from a stale map. Seats are priced at the airline's price with no markup,
 * like bags (ADR-014), and travel with the booking's extras.
 */
@Injectable()
export class FlightSeatsService {
  constructor(
    @Inject(FLIGHT_SUPPLIERS) private readonly suppliers: FlightSupplier[],
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly runner: SupplierRunner,
  ) {}

  /** The seat maps of a flight quote, priced in the quote's currency. Empty when none is sold. */
  async forQuote(quoteId: string): Promise<FlightSeatMapsDto> {
    const quote = await this.prisma.offer.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException();
    const payload = fromJsonValue<ItemPayload>(quote.payload);
    if (payload.kind !== 'flight') throw new NotFoundException();
    if (quote.expiresAt.getTime() <= Date.now()) throw offerUnavailable(payload.request);

    const [maps, fx] = await Promise.all([this.maps(payload.offer), this.fx.converter()]);
    const segments = payload.offer.slices.flatMap((slice) => slice.segments);
    return {
      quoteId: quote.id,
      currency: quote.currency,
      seated: seatedCount(payload.offer),
      flights: maps.flatMap((map) => {
        const segment = segments[map.flight];
        if (!segment) return [];
        return [
          {
            flight: map.flight,
            origin: segment.origin,
            destination: segment.destination,
            carrier: segment.marketingCarrier,
            flightNumber: segment.flightNumber,
            departureLocal: segment.departureLocal,
            cabinClass: map.cabinClass,
            rows: map.rows.map((row) => ({
              number: row.number,
              sections: row.sections.map((section) =>
                section.map((seat) =>
                  seat
                    ? {
                        designator: seat.designator,
                        available: seat.available,
                        price: toWire(fx.convert(seat.price, quote.currency, 'ceil')),
                        features: seat.features,
                      }
                    : null,
                ),
              ),
            })),
          },
        ];
      }),
    };
  }

  /**
   * The chosen seats as booking extras, each with the airline's price from a map fetched now.
   * `positions` maps a passenger's index in the request to their position in the booking.
   * Throws `SeatChoiceError` for a choice that cannot be booked.
   */
  async select(
    offer: SupplierFlightOffer,
    choices: readonly SeatChoice[],
    positions: readonly number[],
  ): Promise<SeatSelection[]> {
    if (choices.length === 0) return [];
    // Booking positions put travellers with a seat first, whatever order the request used.
    const placed = choices.map((choice) => {
      const position = positions[choice.passengerIndex];
      if (position === undefined) throw new SeatChoiceError('unknown_traveller');
      return { ...choice, passengerIndex: position };
    });
    const issue = seatChoiceIssue(placed, seatedCount(offer));
    if (issue) throw new SeatChoiceError(issue);
    const maps = await this.maps(offer);
    return placed.map((choice) => {
      const { map, seat } = findSeat(maps, choice.flight, choice.designator);
      if (!map) throw new SeatChoiceError('unknown_flight');
      if (!seat) throw new SeatChoiceError('unknown_seat');
      if (!seat.available) throw new SeatChoiceError('seat_taken');
      return {
        serviceId: seatServiceId(choice.flight, choice.designator),
        passengerIndex: choice.passengerIndex,
        quantity: 1,
        type: 'seat',
        flight: choice.flight,
        designator: choice.designator,
        price: toWire(seat.price),
      };
    });
  }

  /**
   * Stored seat selections against the airline's map as it is now, on the re-priced offer: the
   * same seats with today's prices, or null when one is taken or no longer on the map. The
   * caller then prices them; a changed seat price is a price change like any other.
   */
  async recheck(
    selections: readonly ExtraSelection[],
    fresh: SupplierFlightOffer,
  ): Promise<SeatSelection[] | null> {
    const seats = selections.filter(isSeat);
    if (seats.length === 0) return [];
    const maps = await this.maps(fresh);
    const checked: SeatSelection[] = [];
    for (const selection of seats) {
      const { seat } = findSeat(maps, selection.flight, selection.designator);
      if (!seat?.available) return null;
      checked.push({ ...selection, price: toWire(seat.price) });
    }
    return checked;
  }

  private maps(offer: SupplierFlightOffer): Promise<SupplierSeatMap[]> {
    const supplier = this.suppliers.find((candidate) => candidate.name === offer.supplier);
    // A supplier switched off since the quote sells no seats; the booking itself fails later.
    if (!supplier) return Promise.resolve([]);
    return this.runner.call('flights', supplier.name, 'seat_maps', (signal) =>
      supplier.seatMaps(offer, signal),
    );
  }
}
