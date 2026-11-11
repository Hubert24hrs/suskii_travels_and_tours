import type { Money } from '@suskii/shared';

import { documentDateTime, documentMoney, newDocument } from './booking-pdf';

// Documents a traveller can pass on before anything is booked: a price request with the offer
// a person verified, and the plan of a combined trip. Each says when it was written, how long
// it holds and what is still to be confirmed, so nobody reads it as a booking. English, like
// the other documents; no name, contact or payment detail is printed on either.

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
