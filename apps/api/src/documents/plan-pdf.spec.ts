import { money } from '@suskii/shared';
import { PDFDocument } from 'pdf-lib';

import { pdfText } from '../../test/helpers/pdf-text';

import {
  renderPriceRequestPdf,
  renderTripPlanPdf,
  renderTripReceiptPdf,
  type PriceRequestDocument,
  type TripReceiptDocument,
} from './plan-pdf';

const request: PriceRequestDocument = {
  reference: 'Q-7K2M4X',
  issuedAt: new Date('2026-11-11T09:00:00Z'),
  link: 'https://www.suskii.test/quotes/0192d3a0-7c1e-7b2a-9f00-00000000d401',
  product: 'hotel',
  title: 'Lagoon View Hotel, sea view room',
  origin: null,
  destination: 'Lagos',
  startDate: '2026-12-12',
  endDate: '2026-12-14',
  adults: 2,
  children: 1,
  status: 'requested',
  answerBy: new Date('2026-11-13T09:00:00Z'),
  indicative: null,
  offer: null,
};

describe('price request PDF', () => {
  it('says a waiting request has no price yet, and when it is answered by', async () => {
    const bytes = await renderPriceRequestPdf(request);
    const pdf = await PDFDocument.load(bytes);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Price request Q-7K2M4X');

    const text = await pdfText(bytes);
    expect(text).toContain('Lagoon View Hotel, sea view room');
    expect(text).toContain('Waiting for our team');
    expect(text).toContain('Sat, 12 Dec 2026 to Mon, 14 Dec 2026');
    expect(text).toContain('Adults: 2. Children: 1.');
    expect(text).toContain('No price has been confirmed yet.');
    expect(text).toContain('Fri, 13 Nov 2026 09:00 UTC');
    expect(text).not.toContain('Our offer');
  });

  it('prints a verified offer with its terms, its total, until when, and that it is no booking', async () => {
    const text = await pdfText(
      await renderPriceRequestPdf({
        ...request,
        status: 'offered',
        indicative: {
          price: money(17_000_000n, 'NGN'),
          source: 'Sample Hotels',
          seenAt: new Date('2026-11-10T08:00:00Z'),
        },
        offer: {
          title: 'Lagoon View Hotel, sea view room',
          // Longer than a line, with a line break of its own: wrapped, never cut.
          summary:
            'Two nights with breakfast for two adults and one child in a sea view room on a high floor, airport pick-up on arrival included.\nFree cancellation until 5 December; after that the first night is charged.',
          startDate: '2026-12-12',
          endDate: '2026-12-14',
          place: 'Lagos',
          refundable: true,
          total: money(18_500_000n, 'NGN'),
          expiresAt: new Date('2026-11-11T11:00:00Z'),
        },
      }),
    );
    expect(text).toContain('Offer ready to book');
    expect(text).toContain('NGN 185,000.00');
    expect(text).toContain('Wed, 11 Nov 2026 11:00 UTC');
    expect(text).toContain('Refundable under the terms below');
    // Every word of the terms is there, across the lines it was wrapped onto.
    const flat = text.replace(/\n/g, ' ');
    expect(flat).toContain('airport pick-up on arrival included.');
    expect(flat).toContain('after that the first night is charged.');
    expect(flat).toContain('It is an offer, not a booking');
    expect(flat).toContain('refunded in full');
    // The price seen elsewhere is shown as what it was: a reference.
    expect(text).toContain('NGN 170,000.00');
    expect(flat).toContain('is not a Suskii price and cannot be booked');
  });
});

describe('trip plan PDF', () => {
  it('prints each part with its price, what is still to choose and pay, and that it is no booking', async () => {
    const bytes = await renderTripPlanPdf({
      reference: 'T-AB12CD',
      issuedAt: new Date('2026-11-11T09:00:00Z'),
      link: 'https://www.suskii.test/trips/0192d3a0-7c1e-7b2a-9f00-00000000d001',
      origin: 'Lagos (LOS)',
      destination: 'London (LHR)',
      departDate: '2026-12-10',
      returnDate: '2026-12-17',
      adults: 2,
      children: 0,
      parts: [
        {
          part: 'Flight',
          what: 'Lagos (LOS) to London (LHR), Air Peace',
          state: 'Paid',
          price: money(165_000_000n, 'NGN'),
        },
        {
          part: 'Hotel',
          what: 'The Palm Suites, London',
          state: 'To pay',
          price: money(90_000_000n, 'NGN'),
        },
      ],
      missing: ['Travel insurance'],
      total: money(255_000_000n, 'NGN'),
      due: money(90_000_000n, 'NGN'),
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Trip plan T-AB12CD');

    const text = await pdfText(bytes);
    expect(text).toContain('Lagos (LOS) to London (LHR)');
    expect(text).toContain('Adults: 2.');
    expect(text).toContain('The Palm Suites, London');
    expect(text).toContain('NGN 1,650,000.00');
    expect(text).toContain('Travel insurance');
    expect(text).toContain('NGN 2,550,000.00');
    expect(text).toContain('NGN 900,000.00');
    const flat = text.replace(/\n/g, ' ');
    expect(flat).toContain('A plan, not a booking.');
    expect(flat).toContain('a part that is not paid is not reserved');
  });
});

const receipt: TripReceiptDocument = {
  reference: 'T-AB12CD',
  issuedAt: new Date('2026-11-14T10:22:00Z'),
  link: 'https://www.suskii.test/trips/0192d3a0-7c1e-7b2a-9f00-00000000d001',
  origin: 'Lagos (LOS)',
  destination: 'London (LHR)',
  departDate: '2026-12-10',
  returnDate: '2026-12-17',
  adults: 2,
  children: 1,
  payments: [
    {
      paidAt: new Date('2026-11-14T10:20:00Z'),
      reference: 'pay_ref_0001',
      method: 'card',
      amount: money(255_000_000n, 'NGN'),
      refunded: null,
    },
  ],
  parts: [
    {
      part: 'Flight',
      booking: 'SK-FLT001',
      what: 'Lagos (LOS) to London (LHR) and back',
      amount: money(165_000_000n, 'NGN'),
      taxes: [],
    },
    {
      part: 'Hotel',
      booking: 'SK-HTL002',
      what: 'The Palm Suites, London, 7 nights',
      amount: money(90_000_000n, 'NGN'),
      taxes: [
        {
          label: 'VAT',
          rateBps: 750,
          amount: money(627_907n, 'NGN'),
          registrationNumber: 'TIN-0001',
        },
      ],
    },
  ],
  total: money(255_000_000n, 'NGN'),
};

describe('trip receipt PDF', () => {
  it('prints the payment, each part with its booking and the tax inside it, and the total paid', async () => {
    const bytes = await renderTripReceiptPdf(receipt);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Receipt T-AB12CD');

    const text = await pdfText(bytes);
    // Headings are printed in capitals.
    expect(text).toContain('PAYMENT\n');
    expect(text).not.toContain('PAYMENTS');
    expect(text).toContain('Sat, 14 Nov 2026 10:20 UTC');
    expect(text).toContain('Card');
    expect(text).toContain('pay_ref_0001');
    expect(text).toContain('SK-FLT001');
    expect(text).toContain('SK-HTL002');
    expect(text).toContain('NGN 1,650,000.00');
    expect(text).toContain('NGN 900,000.00');
    expect(text).toContain('Includes VAT 7.5%');
    expect(text).toContain('TIN-0001');
    expect(text).toContain('NGN 2,550,000.00');
    expect(text).toContain('Adults: 2. Children: 1.');
    expect(text).not.toContain('Refund started');
    // A receipt, never the plan's caveat.
    expect(text.replace(/\n/g, ' ')).not.toContain('A plan, not a booking.');
  });

  it('lists every payment, names a method it does not know in words, and says when a refund started', async () => {
    const text = await pdfText(
      await renderTripReceiptPdf({
        ...receipt,
        payments: [
          {
            paidAt: new Date('2026-11-14T10:20:00Z'),
            reference: 'pay_ref_0001',
            method: 'pay_by_bank',
            amount: money(165_000_000n, 'NGN'),
            refunded: null,
          },
          {
            paidAt: new Date('2026-11-14T11:05:00Z'),
            reference: 'pay_ref_0002',
            method: null,
            amount: money(100_000_000n, 'NGN'),
            refunded: money(10_000_000n, 'NGN'),
          },
        ],
      }),
    );
    expect(text).toContain('PAYMENTS');
    expect(text).toContain('Pay by bank');
    expect(text).toContain('pay_ref_0002');
    expect(text).toContain('Sat, 14 Nov 2026 11:05 UTC');
    expect(text).toContain('Refund started');
    expect(text).toContain('NGN 100,000.00');
  });
});
