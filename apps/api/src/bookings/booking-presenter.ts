import {
  checkPassengers,
  daysBetween,
  subtract,
  toWire,
  type ContactDetails,
  type PassengerIssue,
} from '@suskii/shared';

import { fromJsonValue } from '../common/json';
import type { Prisma } from '../generated/prisma/client';
import type { Converter } from '../pricing/fx.service';

import { maskEmail, maskPhone } from './booking-codes';
import {
  bookedRate,
  itineraryFacts,
  totalOf,
  type ExtraSelection,
  type ItemPayload,
} from './booking-pricing';
import type { BookingDto, BookingPriceDto } from './bookings.schemas';

export const BOOKING_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' } },
  passengers: { orderBy: { position: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  documents: { orderBy: { type: 'asc' } },
} satisfies Prisma.BookingInclude;

export type BookingRecord = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;
export type BookingItemRecord = BookingRecord['items'][number];

/** A re-price waiting for consent: the new price and the offers it was computed from. */
export interface PendingPrice {
  price: BookingPriceDto;
  items: {
    id: string;
    supplierOfferId: string;
    payload: ItemPayload;
    services: ExtraSelection[];
  }[];
}

export const itemPayload = (item: { payload: unknown }): ItemPayload =>
  fromJsonValue<ItemPayload>(item.payload);
export const itemServices = (item: { services: unknown }): ExtraSelection[] =>
  fromJsonValue<ExtraSelection[]>(item.services);
export const bookingPrice = (booking: { price: unknown }): BookingPriceDto =>
  booking.price as BookingPriceDto;
export const pendingPrice = (booking: { pendingPrice: unknown }): PendingPrice | null =>
  booking.pendingPrice ? fromJsonValue<PendingPrice>(booking.pendingPrice) : null;

const isoDate = (date: Date | null): string | null => date?.toISOString().slice(0, 10) ?? null;

/** Passport warnings (expiring within six months of the trip), recomputed from stored facts. */
function passengerWarnings(booking: BookingRecord, payload: ItemPayload): PassengerIssue[] {
  if (payload.kind !== 'flight') return [];
  const facts = booking.passengers.map((passenger) => ({
    type: passenger.type,
    dateOfBirth: isoDate(passenger.dateOfBirth) ?? '',
    document: passenger.documentExpiry
      ? { expiryDate: isoDate(passenger.documentExpiry) ?? '' }
      : null,
  }));
  return checkPassengers(facts, itineraryFacts(payload)).warnings;
}

/** The customer view of a booking: contact details and passports masked, costs internal. */
export function toBookingDto(
  booking: BookingRecord,
  contact: ContactDetails,
  fx: Converter,
  now: Date,
): BookingDto {
  const item = booking.items[0];
  if (!item) throw new Error(`Booking ${booking.id} has no items`);
  const payload = itemPayload(item);
  const services = itemServices(item);
  const tickets = (item.ticketNumbers as { passengerIndex: number; number: string }[] | null) ?? [];
  const price = bookingPrice(booking);
  const pending = pendingPrice(booking);
  const payment = booking.payments[0];

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    vertical: payload.kind === 'flight' ? 'flights' : 'hotels',
    createdAt: booking.createdAt.toISOString(),
    paymentDeadline: booking.paymentDeadline?.toISOString() ?? null,
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    contact: { email: maskEmail(contact.email), phone: maskPhone(contact.phone) },
    price,
    pendingPriceChange: pending
      ? {
          previous: price.total,
          current: pending.price.total,
          difference: toWire(subtract(totalOf(pending.price), totalOf(price))),
          price: pending.price,
        }
      : null,
    flight:
      payload.kind === 'flight'
        ? {
            owner: payload.offer.owner,
            slices: payload.offer.slices,
            baggage: payload.offer.baggage,
            conditions: {
              refundable: payload.offer.conditions.refundable,
              changeable: payload.offer.conditions.changeable,
            },
            cabinClass: payload.offer.cabinClass,
            airlineReference: item.supplierReference,
            request: payload.request,
          }
        : null,
    hotel:
      payload.kind === 'hotel'
        ? (() => {
            const rate = bookedRate(payload);
            return {
              name: payload.hotel.name,
              stars: payload.hotel.stars,
              area: payload.hotel.area,
              cityName: payload.hotel.cityName,
              countryCode: payload.hotel.countryCode,
              checkIn: payload.request.checkIn,
              checkOut: payload.request.checkOut,
              nights: daysBetween(payload.request.checkIn, payload.request.checkOut),
              rooms: payload.request.rooms.length,
              roomName: rate.roomName,
              board: rate.board,
              refundable: rate.refundable,
              freeCancellationUntil: rate.freeCancellationUntil,
              payAtProperty: rate.payAtProperty
                ? toWire(fx.convert(rate.payAtProperty, booking.currency))
                : null,
              confirmationNumber: item.supplierReference,
              request: payload.request,
            };
          })()
        : null,
    passengers: booking.passengers.map((passenger) => ({
      position: passenger.position,
      type: passenger.type,
      title: passenger.title as BookingDto['passengers'][number]['title'],
      givenNames: passenger.givenNames,
      surname: passenger.surname,
      dateOfBirth: isoDate(passenger.dateOfBirth),
      roomIndex: passenger.roomIndex,
      document:
        passenger.documentHint && passenger.issuingCountry && passenger.documentExpiry
          ? {
              hint: passenger.documentHint,
              issuingCountry: passenger.issuingCountry,
              expiryDate: isoDate(passenger.documentExpiry) ?? '',
            }
          : null,
      ticketNumber:
        tickets.find((ticket) => ticket.passengerIndex === passenger.position)?.number ?? null,
      extraBags: services
        .filter((selection) => selection.passengerIndex === passenger.position)
        .reduce((acc, selection) => acc + selection.quantity, 0),
    })),
    warnings: passengerWarnings(booking, payload),
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          amount: { amountMinor: Number(payment.amountMinor), currency: payment.currency },
          checkoutUrl:
            payment.status === 'pending' &&
            booking.status === 'AWAITING_PAYMENT' &&
            payment.expiresAt > now
              ? payment.checkoutUrl
              : null,
          expiresAt: payment.expiresAt.toISOString(),
        }
      : null,
    documents: booking.documents.map((document) => ({
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      sizeBytes: document.sizeBytes,
      createdAt: document.createdAt.toISOString(),
    })),
  };
}
