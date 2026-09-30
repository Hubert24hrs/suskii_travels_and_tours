import { Injectable, NotFoundException } from '@nestjs/common';

import { daysBetween, money } from '@suskii/shared';

import {
  documentDateTime,
  renderInhouseVoucherPdf,
  renderTicketPdf,
  renderVisaConfirmationPdf,
  renderVoucherPdf,
  type TicketDocument,
  type VoucherDocument,
} from '../documents/booking-pdf';
import { VISA_DISCLAIMER } from '../notifications/templates';
import { ObjectStorage } from '../documents/object-storage';
import { Prisma, type BookingDocumentType } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { FxService } from '../pricing/fx.service';

import { bookedRate, isInhouse, type ItemPayload } from './booking-pricing';
import { InhouseFulfilment } from './inhouse-fulfilment';
import type { InhouseItemPayload } from './inhouse-items';
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
  package_voucher: 'package-voucher',
  tour_voucher: 'tour-voucher',
  addon_voucher: 'add-on-voucher',
  visa_confirmation: 'visa-confirmation',
};

const DOCUMENT_TYPE: Record<ItemPayload['kind'], BookingDocumentType> = {
  flight: 'e_ticket',
  hotel: 'hotel_voucher',
  package: 'package_voucher',
  tour: 'tour_voucher',
  addon: 'addon_voucher',
  visa: 'visa_confirmation',
};

const documentType = (payload: ItemPayload): BookingDocumentType => DOCUMENT_TYPE[payload.kind];

const PURPOSE_TEXT: Record<string, string> = {
  tourism: 'Tourism',
  business: 'Business',
  study: 'Study',
  transit: 'Transit',
};

/** "Full refund up to 30 days before; 50% up to 7 days before; no refund after." */
function cancellationLines(tiers: readonly { daysBefore: number; refundBps: number }[]): string[] {
  const sorted = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
  const lines = sorted.map((tier) => {
    const share =
      tier.refundBps >= 10_000
        ? 'Full refund'
        : tier.refundBps <= 0
          ? 'No refund'
          : `${(tier.refundBps / 100).toFixed(tier.refundBps % 100 === 0 ? 0 : 2)}% refund`;
    return tier.daysBefore === 0
      ? `${share} if cancelled before the start date.`
      : `${share} if cancelled at least ${tier.daysBefore} days before the start.`;
  });
  return [...lines, 'Cancel from your booking page; refunds go back to how you paid.'];
}

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
    private readonly fulfilment: InhouseFulfilment,
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
      await this.record(booking.id, type, { storageKey, fileName, sizeBytes: bytes.byteLength });
      documents.push({ type, fileName, contentType: 'application/pdf', bytes });
    }
    return documents;
  }

  /**
   * Upserts the document row. Two generations can race (ticketing and a backfill); both wrote the
   * same deterministic file, so losing the insert race simply means updating the winner's row.
   */
  private async record(
    bookingId: string,
    type: BookingDocumentType,
    data: { storageKey: string; fileName: string; sizeBytes: number },
  ): Promise<void> {
    const upsert = () =>
      this.prisma.bookingDocument.upsert({
        where: { bookingId_type: { bookingId, type } },
        create: { bookingId, type, contentType: 'application/pdf', ...data },
        update: data,
      });
    try {
      await upsert();
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      await upsert();
    }
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
    if (isInhouse(payload)) return this.renderInhouse(booking, item, payload, total, issuedAt);
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

  private async renderInhouse(
    booking: BookingRecord,
    item: BookingRecord['items'][number],
    payload: InhouseItemPayload,
    total: ReturnType<typeof money>,
    issuedAt: Date,
  ): Promise<Uint8Array> {
    const names = booking.passengers.map(
      (passenger) => `${passenger.givenNames} ${passenger.surname}`,
    );
    if (payload.kind === 'visa') {
      return renderVisaConfirmationPdf({
        reference: booking.reference,
        issuedAt,
        title: payload.title,
        sample: payload.sample,
        destination: payload.destination,
        purpose: PURPOSE_TEXT[payload.purpose] ?? payload.purpose,
        travelDate: payload.travelDate,
        processingDays: `${payload.processingDaysMin} to ${payload.processingDaysMax} working days after you submit`,
        applicants: names,
        governmentFeeNote: payload.governmentFeeNote,
        disclaimer: VISA_DISCLAIMER,
        total,
      });
    }
    const voucher = await this.prisma.bookingVoucher.findUnique({
      where: { bookingItemId: item.id },
    });
    if (!voucher) throw new Error(`Voucher missing for booking item ${item.id}`);
    const view = this.fulfilment.view(voucher);
    const when: [string, string][] =
      payload.kind === 'tour'
        ? [
            ['Starts', `${documentDateTime(payload.startsAtLocal)} (local time)`],
            [
              'Duration',
              `${Math.floor(payload.durationMinutes / 60)}h ${payload.durationMinutes % 60}m`,
            ],
          ]
        : [
            ['From', documentDateTime(payload.startDate)],
            ['To', documentDateTime(payload.endDate)],
            ...(payload.kind === 'package'
              ? ([['Nights', String(payload.nights)]] as [string, string][])
              : []),
          ];
    return renderInhouseVoucherPdf({
      kind: payload.kind,
      reference: booking.reference,
      voucherCode: view.code,
      qrPayload: payload.kind === 'tour' ? view.qrPayload : null,
      issuedAt,
      title: payload.title,
      sample: payload.sample,
      place:
        payload.kind === 'addon'
          ? payload.cityName
          : [payload.cityName, payload.countryCode].filter(Boolean).join(', '),
      when,
      meetingPoint: payload.kind === 'tour' ? payload.meetingPoint : null,
      travellers: names,
      inclusions: payload.kind === 'addon' ? [] : payload.inclusions,
      cancellation: cancellationLines(payload.cancellationPolicy),
      total,
    });
  }
}
