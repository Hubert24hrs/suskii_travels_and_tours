import type { Money } from '@suskii/shared';

import {
  type DocumentTax,
  documentDateTime,
  documentMoney,
  newDocument,
  writeServiceTaxes,
} from './booking-pdf';

// Documents a traveller can pass on before anything is booked: a price request with the offer
// a person verified, and the plan of a combined trip. Each says when it was written, how long
// it holds and what is still to be confirmed, so nobody reads it as a booking. Once a combined
// trip is paid, its receipt says what the payment came to and what each part took. English,
// like the other documents; no name, contact or card detail is printed on any of them.

const utc = (value: Date): string => `${documentDateTime(value.toISOString().slice(0, 16))} UTC`;

const people = (adults: number, children: number): string =>
  children > 0 ? `Adults: ${adults}. Children: ${children}.` : `Adults: ${adults}.`;

const dates = (start: string, end: string | null): string =>
  end && end !== start
    ? `${documentDateTime(start)} to ${documentDateTime(end)}`
    : documentDateTime(start);

/** A price request (ADR-104), with the verified offer once there is one. */
export interface PriceRequestDocument {
  reference: string;
  issuedAt: Date;
  /** Where the request can be opened; printed as a QR code. */
  link: string;
  product: string;
  title: string;
  origin: string | null;
  destination: string;
  startDate: string;
  endDate: string | null;
  adults: number;
  children: number;
  status: 'requested' | 'offered' | 'unavailable' | 'expired' | 'withdrawn' | 'booked';
  answerBy: Date;
  /** A price seen elsewhere that the request came from: a reference, never Suskii's price. */
  indicative: { price: Money; source: string; seenAt: Date } | null;
  offer: {
    title: string;
    summary: string;
    startDate: string;
    endDate: string;
    place: string | null;
    refundable: boolean;
    total: Money;
    expiresAt: Date;
  } | null;
}

const REQUEST_STATUS: Record<PriceRequestDocument['status'], string> = {
  requested: 'Waiting for our team',
  offered: 'Offer ready to book',
  booked: 'Booked',
  unavailable: 'Not available',
  expired: 'Ran out of time',
  withdrawn: 'Withdrawn',
};

export async function renderPriceRequestPdf(request: PriceRequestDocument): Promise<Uint8Array> {
  const { pdf, writer } = await newDocument('Price request', request.reference, request.link);
  writer.pair('Reference', request.reference);
  writer.pair('Written on', utc(request.issuedAt));
  writer.pair('Status', REQUEST_STATUS[request.status]);

  writer.heading('What was asked for');
  writer.line(request.title, { bold: true, size: 11 });
  writer.pair('Kind', request.product);
  writer.pair(
    'Where',
    request.origin ? `${request.origin} to ${request.destination}` : request.destination,
  );
  writer.pair('When', dates(request.startDate, request.endDate));
  writer.pair('For', people(request.adults, request.children));

  if (request.indicative) {
    writer.heading('Price seen elsewhere');
    writer.pair(
      `${request.indicative.source}, ${utc(request.indicative.seenAt)}`,
      documentMoney(request.indicative.price),
    );
    writer.paragraph(
      'A reference only: it was read on another website, is not a Suskii price and cannot be booked. Our team checks the live price with the supplier.',
    );
  }

  const { offer } = request;
  if (offer) {
    writer.heading('Our offer');
    writer.line(offer.title, { bold: true, size: 11 });
    if (offer.place) writer.pair('Where', offer.place);
    writer.pair('When', dates(offer.startDate, offer.endDate));
    writer.pair('Total, all in', documentMoney(offer.total));
    writer.pair('Refund', offer.refundable ? 'Refundable under the terms below' : 'Not refundable');
    writer.pair(
      request.status === 'offered' ? 'Can be booked until' : 'Offer ended',
      utc(offer.expiresAt),
    );
    writer.gap(4);
    writer.paragraph(offer.summary);
    writer.gap(4);
    writer.paragraph(
      'A person on our team confirmed this price with the supplier. It is an offer, not a booking: nothing is reserved until you book and pay. After payment a person books it with the supplier, and it is confirmed only once they have the confirmation. If it cannot be booked you are refunded in full.',
    );
  } else if (request.status === 'requested') {
    writer.heading('To be confirmed');
    writer.paragraph(
      `No price has been confirmed yet. A person on our team checks the live price with the supplier and answers by ${utc(request.answerBy)}. Nothing is charged until you book an offer.`,
    );
  }
  return pdf.save();
}

/** The plan of a combined trip (ADR-099): the parts chosen so far, each price and one total. */
export interface TripPlanDocument {
  reference: string;
  issuedAt: Date;
  link: string;
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  adults: number;
  children: number;
  parts: { part: string; what: string; state: string; price: Money }[];
  /** Parts the plan asks for that nothing has been chosen for yet. */
  missing: string[];
  total: Money;
  due: Money;
}

export async function renderTripPlanPdf(trip: TripPlanDocument): Promise<Uint8Array> {
  const { pdf, writer } = await newDocument('Trip plan', trip.reference, trip.link);
  writer.pair('Reference', trip.reference);
  writer.pair('Written on', utc(trip.issuedAt));

  writer.heading('The trip');
  writer.pair('Route', `${trip.origin} to ${trip.destination}`);
  writer.pair('Dates', dates(trip.departDate, trip.returnDate));
  writer.pair('Travellers', people(trip.adults, trip.children));

  writer.heading('Parts chosen');
  if (trip.parts.length === 0) writer.line('Nothing has been chosen yet.');
  for (const part of trip.parts) {
    writer.pair(part.part, part.what);
    writer.pair(`  ${part.state}`, documentMoney(part.price));
  }
  if (trip.missing.length > 0) {
    writer.gap(4);
    writer.pair('Still to choose', trip.missing.join(', '));
  }

  writer.heading('Price');
  writer.pair('Total for the parts chosen', documentMoney(trip.total));
  writer.pair('Still to pay', documentMoney(trip.due));
  writer.gap(4);
  writer.paragraph(
    'A plan, not a booking. Prices are those shown when this was written and are confirmed with each supplier when you pay; a part that is not paid is not reserved and its price can change. Each part keeps its own conditions for changes and refunds.',
  );
  return pdf.save();
}

/**
 * The receipt of a paid combined trip (ADR-099): each payment that went through, what each part
 * of the trip took from it with the taxes on our service inside, and the total paid.
 */
export interface TripReceiptDocument {
  reference: string;
  issuedAt: Date;
  /** The trip's page; printed as a QR code. */
  link: string;
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  adults: number;
  children: number;
  payments: {
    paidAt: Date;
    /** Our reference for the payment, as the provider shows it to the traveller. */
    reference: string;
    /** The channel the provider reported (card, bank_transfer, ussd), never card details. */
    method: string | null;
    amount: Money;
    /** What the payment took that no booking could keep, refunded automatically. */
    refunded: Money | null;
  }[];
  parts: { part: string; booking: string; what: string; amount: Money; taxes: DocumentTax[] }[];
  total: Money;
}

const PAYMENT_METHODS: Record<string, string> = {
  card: 'Card',
  bank: 'Bank account',
  bank_transfer: 'Bank transfer',
  ussd: 'USSD',
  qr: 'QR code',
  mobile_money: 'Mobile money',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  agent: 'Cash at an agent',
};

/** "Card", "Bank transfer": a provider's channel name as a person reads it. */
function methodText(method: string): string {
  const known = PAYMENT_METHODS[method];
  if (known) return known;
  const words = method.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function renderTripReceiptPdf(receipt: TripReceiptDocument): Promise<Uint8Array> {
  const { pdf, writer } = await newDocument('Receipt', receipt.reference, receipt.link);
  writer.pair('Trip reference', receipt.reference);
  writer.pair('Written on', utc(receipt.issuedAt));

  writer.heading(receipt.payments.length > 1 ? 'Payments' : 'Payment');
  for (const [index, payment] of receipt.payments.entries()) {
    if (index > 0) writer.gap(4);
    writer.pair('Paid on', utc(payment.paidAt));
    writer.pair('Amount', documentMoney(payment.amount));
    if (payment.method) writer.pair('Paid by', methodText(payment.method));
    writer.pair('Payment reference', payment.reference);
    if (payment.refunded) writer.pair('Refund started', documentMoney(payment.refunded));
  }

  writer.heading('The trip');
  writer.pair('Route', `${receipt.origin} to ${receipt.destination}`);
  writer.pair('Dates', dates(receipt.departDate, receipt.returnDate));
  writer.pair('Travellers', people(receipt.adults, receipt.children));

  writer.heading('What was paid for');
  for (const [index, part] of receipt.parts.entries()) {
    if (index > 0) writer.gap(4);
    writer.pair(part.part, part.what);
    writer.pair('Booking', part.booking);
    writer.pair('Paid', documentMoney(part.amount));
    writeServiceTaxes(writer, part.taxes);
  }

  writer.heading('Total');
  writer.pair('Total paid', documentMoney(receipt.total));
  writer.gap(8);
  writer.paragraph(
    'Each part is its own booking. Its tickets or vouchers, its conditions for changes and refunds, and any refund made later are on its booking page.',
  );
  return pdf.save();
}
