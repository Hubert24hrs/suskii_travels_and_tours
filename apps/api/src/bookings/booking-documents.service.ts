import { Injectable, NotFoundException } from '@nestjs/common';

import { daysBetween, money } from '@suskii/shared';

import {
  renderTicketPdf,
  renderVoucherPdf,
  type TicketDocument,
  type VoucherDocument,
} from '../documents/booking-pdf';
import { ObjectStorage } from '../documents/object-storage';
import type { BookingDocumentType } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { FxService } from '../pricing/fx.service';

import { bookedRate, type ItemPayload } from './booking-pricing';
import {
  BOOKING_INCLUDE,
  itemPayload,
  itemServices,
  type BookingRecord,
} from './booking-presenter';

export interface GeneratedDocument {
  type: BookingDocumentType;
  fileName: string;
  contentType: 'application/pdf';
  bytes: Uint8Array;
}

const FILE_PREFIX: Record<BookingDocumentType, string> = {
  e_ticket: 'e-ticket',
  hotel_voucher: 'hotel-voucher',
};

const documentType = (payload: ItemPayload): BookingDocumentType =>
  payload.kind === 'flight' ? 'e_ticket' : 'hotel_voucher';

/**
 * E-tickets and hotel vouchers (ADR-014): rendered once the booking is confirmed, kept in private
 * object storage and served only through the booking's access rules. A missing file is simply
 * rendered again from the booking.
 */
@Injectable()
export class BookingDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly fx: FxService,
  ) {}

  /** Makes sure every document of a confirmed booking exists; returns them (e.g. for email). */
  async ensure(bookingId: string, regenerate = false): Promise<GeneratedDocument[]> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });
    if (booking.status !== 'CONFIRMED') return [];
    const documents: GeneratedDocument[] = [];
    for (const item of booking.items) {
      const payload = itemPayload(item);
      const type = documentType(payload);
      const existing = booking.documents.find((document) => document.type === type);
      const stored = existing && !regenerate ? await this.storage.get(existing.storageKey) : null;
      if (existing && stored) {
        documents.push({
          type,
          fileName: existing.fileName,
          contentType: 'application/pdf',
          bytes: stored,
        });
        continue;
      }
      const bytes = await this.render(booking, item, payload);
      const storageKey = `bookings/${booking.id}/${FILE_PREFIX[type]}.pdf`;
      const fileName = `Suskii-${FILE_PREFIX[type]}-${booking.reference}.pdf`;
      await this.storage.put(storageKey, bytes, 'application/pdf');
      await this.prisma.bookingDocument.upsert({
        where: { bookingId_type: { bookingId: booking.id, type } },
        create: {
          bookingId: booking.id,
          type,
          storageKey,
          fileName,
          contentType: 'application/pdf',
          sizeBytes: bytes.byteLength,
        },
        update: { storageKey, fileName, sizeBytes: bytes.byteLength },
      });
      documents.push({ type, fileName, contentType: 'application/pdf', bytes });
    }
    return documents;
  }

  /** One document of a booking the caller may already access. */
  async read(
    booking: BookingRecord,
    documentId: string,
  ): Promise<{ fileName: string; bytes: Uint8Array }> {
    const document = booking.documents.find((candidate) => candidate.id === documentId);
    if (!document) throw new NotFoundException();
    const stored = await this.storage.get(document.storageKey);
    if (stored) return { fileName: document.fileName, bytes: stored };
    const regenerated = (await this.ensure(booking.id, true)).find(
      (candidate) => candidate.type === document.type,
    );
    if (!regenerated) throw new NotFoundException();
    return { fileName: regenerated.fileName, bytes: regenerated.bytes };
  }

  private async render(
    booking: BookingRecord,
    item: BookingRecord['items'][number],
    payload: ItemPayload,
  ): Promise<Uint8Array> {
    const total = money(booking.totalMinor, booking.currency);
    const issuedAt = booking.confirmedAt ?? new Date();
    if (payload.kind === 'flight') {
      const services = itemServices(item);
      const tickets =
        (item.ticketNumbers as { passengerIndex: number; number: string }[] | null) ?? [];
      const ticket: TicketDocument = {
        reference: booking.reference,
        airlineReference: item.supplierReference ?? '',
        issuedAt,
        airline: payload.offer.owner,
        passengers: booking.passengers.map((passenger) => ({
          surname: passenger.surname,
          givenNames: passenger.givenNames,
          title: passenger.title,
          type: passenger.type,
          ticketNumber:
            tickets.find((entry) => entry.passengerIndex === passenger.position)?.number ?? null,
          extraBags: services
            .filter((selection) => selection.passengerIndex === passenger.position)
            .reduce((acc, selection) => acc + selection.quantity, 0),
        })),
        slices: payload.offer.slices.map((slice) => ({
          origin: slice.origin,
          destination: slice.destination,
          departureLocal: slice.departureLocal,
          arrivalLocal: slice.arrivalLocal,
          arrivalDayOffset: slice.arrivalDayOffset,
          durationMinutes: slice.durationMinutes,
          segments: slice.segments.map((segment) => ({
            flightNumber: segment.flightNumber,
            carrierCode: segment.marketingCarrier.code,
            originCode: segment.origin.code,
            destinationCode: segment.destination.code,
            departureLocal: segment.departureLocal,
            arrivalLocal: segment.arrivalLocal,
            cabinClass: segment.cabinClass,
          })),
        })),
        baggage: payload.offer.baggage,
        conditions: {
          refundable: payload.offer.conditions.refundable,
          changeable: payload.offer.conditions.changeable,
        },
        total,
      };
      return renderTicketPdf(ticket);
    }
    const rate = bookedRate(payload);
    const fx = await this.fx.converter();
    const voucher: VoucherDocument = {
      reference: booking.reference,
      confirmationNumber: item.supplierReference ?? '',
      issuedAt,
      hotel: {
        name: payload.hotel.name,
        stars: payload.hotel.stars,
        area: payload.hotel.area,
        cityName: payload.hotel.cityName,
        countryCode: payload.hotel.countryCode,
      },
      checkIn: payload.request.checkIn,
      checkOut: payload.request.checkOut,
      nights: daysBetween(payload.request.checkIn, payload.request.checkOut),
      roomName: rate.roomName,
      board: rate.board,
      rooms: payload.request.rooms.length,
      guests: booking.passengers.map((guest) => `${guest.givenNames} ${guest.surname}`),
      refundable: rate.refundable,
      freeCancellationUntil: rate.freeCancellationUntil
        ? new Date(rate.freeCancellationUntil)
        : null,
      payAtProperty: rate.payAtProperty ? fx.convert(rate.payAtProperty, booking.currency) : null,
      total,
    };
    return renderVoucherPdf(voucher);
  }
}
