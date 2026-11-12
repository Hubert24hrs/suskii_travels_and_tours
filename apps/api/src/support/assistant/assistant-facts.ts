import { formatMoney, money, type MoneyWire } from '@suskii/shared';

import type { BookingDto } from '../../bookings/bookings.schemas';

/** One thing the assistant may say about a booking, with the key it cites (ADR-085). */
export interface AssistantFact {
  key: string;
  text: string;
}

/** Amounts as travellers read them on receipts ("₦250,000.00"). */
const LOCALE = 'en-NG';

const amount = (value: MoneyWire): string =>
  formatMoney(money(value.amountMinor, value.currency), LOCALE);

/** "2026-12-01T10:25" to "2026-12-01 10:25". */
const wall = (local: string): string => local.replace('T', ' ').slice(0, 16);

/** "2026-11-02T13:00:00.000Z" to "2026-11-02 13:00 UTC". */
const utc = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const STATUS: Record<BookingDto['status'], string> = {
  DRAFT: 'not finished (no payment yet)',
  PRICED: 'priced, waiting for the traveller to pay',
  HELD: 'reserved on hold, waiting for payment',
  AWAITING_PAYMENT: 'waiting for payment',
  PARTIALLY_PAID: 'partly paid (on a payment plan)',
  PAID: 'paid, being confirmed with the supplier',
  TICKETING: 'paid, tickets being issued',
  CONFIRMED: 'confirmed',
  FAILED: 'failed (the supplier could not confirm it)',
  CANCELLED: 'cancelled',
  REFUND_PENDING: 'cancelled, refund in progress',
  REFUNDED: 'refunded',
  EXPIRED: 'expired (not paid in time)',
};

const DOCUMENTS: Record<BookingDto['documents'][number]['type'], string> = {
  e_ticket: 'e-ticket',
  hotel_voucher: 'hotel voucher',
  package_voucher: 'package voucher',
  tour_voucher: 'tour voucher',
  addon_voucher: 'add-on voucher',
  visa_confirmation: 'visa assistance confirmation',
  bus_ticket: 'bus ticket',
};

const place = (point: { code: string; cityName: string | null }): string =>
  point.cityName ? `${point.cityName} (${point.code})` : point.code;

const tiers = (policy: { daysBefore: number; refundBps: number }[]): string =>
  policy.length === 0
    ? 'not refundable once confirmed'
    : policy
        .map((tier) => `${tier.refundBps / 100}% back if cancelled ${tier.daysBefore}+ days before`)
        .join('; ');

/**
 * What the after-hours assistant may know about a booking (ADR-085), from the traveller's own
 * view of it. Status, products, places, local times, money, refundability and progress only:
 * never names, contact details, passport data, ticket numbers, voucher codes, supplier
 * confirmation codes, payment links or the booking reference.
 */
export function assistantBookingFacts(booking: BookingDto): AssistantFact[] {
  const facts: AssistantFact[] = [];
  const add = (key: string, text: string): void => void facts.push({ key, text });

  add('booking.status', `Booking status: ${STATUS[booking.status]}.`);
  add(
    'booking.payment',
    `Total price: ${amount(booking.price.total)}. Paid so far: ${amount(booking.paid)}.` +
      (booking.amountDue ? ` Next payment: ${amount(booking.amountDue)}.` : ''),
  );
  if (booking.paymentDeadline && booking.paymentOptions) {
    add('booking.pay-by', `Pay by ${utc(booking.paymentDeadline)} or the booking is released.`);
  }
  const plan = booking.paymentPlan;
  if (plan) {
    const next = plan.installments.find((installment) => installment.status === 'pending');
    add(
      'booking.plan',
      `Payment plan (${plan.kind.replace('_', ' ')}): ${plan.status}.` +
        (next ? ` Next instalment ${amount(next.amount)} due ${utc(next.dueAt)}.` : '') +
        ` Missed payments have ${plural(plan.graceHours, 'hour', 'hours')} of grace.`,
    );
  }
  if (booking.pendingPriceChange) {
    add(
      'booking.price-change',
      `The price changed to ${amount(booking.pendingPriceChange.current)} and waits for the traveller to accept it on the booking page before payment.`,
    );
  }
  if (booking.company?.approvalStatus === 'pending') {
    add('booking.approval', 'A company trip waiting for an approver before it can be paid.');
  }

  const flight = booking.flight;
  if (flight) {
    flight.slices.forEach((slice, index) => {
      add(
        `flight.${index + 1}`,
        `Flight ${index + 1}: ${place(slice.origin)} to ${place(slice.destination)} with ${flight.owner.name}, ` +
          `departs ${wall(slice.departureLocal)} and arrives ${wall(slice.arrivalLocal)} (local times), ` +
          `${slice.stops === 0 ? 'direct' : plural(slice.stops, 'stop', 'stops')}.`,
      );
    });
    add(
      'flight.baggage',
      `Baggage per traveller: ${plural(flight.baggage.carryOn, 'carry-on bag', 'carry-on bags')} and ${plural(flight.baggage.checked, 'checked bag', 'checked bags')}.`,
    );
    add(
      'flight.conditions',
      `Fare refundable: ${yesNo(flight.conditions.refundable)}. Changes allowed by the fare: ${yesNo(flight.conditions.changeable)}.`,
    );
    if (booking.flightCancellable) {
      add(
        'flight.cancel-online',
        'This ticketed flight can be cancelled online from the booking page, which shows the refund first.',
      );
    }
  }
  const change = booking.scheduleChange;
  if (change?.status === 'open') {
    add(
      'flight.schedule-change',
      `The airline changed this flight on ${utc(change.detectedAt)}. ` +
        (change.acceptable
          ? 'The traveller can review and accept the change on the booking page.'
          : 'Support will contact the traveller about it.') +
        (change.refundOffer
          ? ` Instead, they can take a full refund of ${amount(change.refundOffer.amount)} from the booking page.`
          : ''),
    );
  }

  const hotel = booking.hotel;
  if (hotel) {
    add(
      'hotel.stay',
      `Hotel: ${hotel.name}, ${hotel.cityName}. Check-in ${hotel.checkIn}, check-out ${hotel.checkOut} (${plural(hotel.nights, 'night', 'nights')}), ` +
        `${plural(hotel.rooms, 'room', 'rooms')}: ${hotel.roomName}, ${hotel.board.replaceAll('_', ' ')}.`,
    );
    add(
      'hotel.cancellation',
      hotel.refundable
        ? `Refundable: yes${hotel.freeCancellationUntil ? `, free cancellation until ${utc(hotel.freeCancellationUntil)}` : ''}.`
        : 'Refundable: no.',
    );
    if (hotel.payAtProperty) {
      add('hotel.pay-at-property', `To pay at the hotel: ${amount(hotel.payAtProperty)}.`);
    }
  }

  const inhouse = booking.package ?? booking.tour;
  if (booking.package) {
    const item = booking.package;
    add(
      'package.trip',
      `Package: ${item.product.title}, ${item.cityName}, ${item.startDate} to ${item.endDate} (${plural(item.nights, 'night', 'nights')}). Includes: ${item.inclusions.join(', ') || 'see the booking page'}.`,
    );
  }
  if (booking.tour) {
    const item = booking.tour;
    add(
      'tour.trip',
      `Tour: ${item.product.title}, ${item.cityName}, starts ${wall(item.startsAtLocal)} local time, lasts ${plural(Math.round(item.durationMinutes / 60), 'hour', 'hours')}.`,
    );
  }
  if (inhouse)
    add('booking.cancellation-policy', `Cancellation: ${tiers(inhouse.cancellationPolicy)}.`);
  if (booking.cancellation) {
    add(
      'booking.cancel-now',
      `Cancelling now from the booking page would refund ${amount(booking.cancellation.refund)}.`,
    );
  }
  if (booking.visa) {
    const item = booking.visa;
    const statuses = item.applications.map((application) =>
      application.status.replaceAll('_', ' '),
    );
    add(
      'visa.application',
      `Visa assistance: ${item.product.title} for travel on ${item.travelDate}, usually ${item.processingDaysMin} to ${item.processingDaysMax} days to process.` +
        (statuses.length > 0 ? ` Application status: ${statuses.join(', ')}.` : ''),
    );
  }
  if (booking.bus) {
    const item = booking.bus;
    add(
      'bus.trip',
      `Bus: ${item.operatorName}, ${item.origin.cityName} (${item.origin.name}) to ${item.destination.cityName} (${item.destination.name}), departs ${wall(item.departsAtLocal)} local time, ${plural(item.seats.length, 'seat', 'seats')}.`,
    );
  }
  if (booking.rental) {
    const item = booking.rental;
    add(
      'rental.car',
      `Car rental: ${item.vehicle.make} ${item.vehicle.model} from ${item.branch.name}, ${item.cityName}; pick-up ${wall(item.pickupAtLocal)}, return ${wall(item.returnAtLocal)} (local times). Refundable deposit: ${amount(item.charge.deposit)}.`,
    );
  }
  if (booking.addon) {
    const item = booking.addon;
    add('addon.item', `Add-on: ${item.product.title}, ${item.startDate} to ${item.endDate}.`);
  }
  if (booking.membership) {
    const item = booking.membership;
    add(
      'membership.term',
      `Suskii Prime (${item.period}).` +
        (item.term ? ` Membership runs to ${utc(item.term.endsAt)}.` : ''),
    );
  }

  const documents = [...new Set(booking.documents.map((document) => DOCUMENTS[document.type]))];
  add(
    'booking.documents',
    documents.length > 0
      ? `Ready to download on the booking page: ${documents.join(', ')}.`
      : 'No travel documents are ready yet.',
  );
  booking.refunds.forEach((refund, index) => {
    add(
      `booking.refund.${index + 1}`,
      `Refund of ${amount(refund.amount)}: ${refund.status.replace('_', ' ')}.`,
    );
  });
  return facts;
}
