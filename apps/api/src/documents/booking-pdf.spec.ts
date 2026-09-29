import { money } from '@suskii/shared';
import { PDFDocument } from 'pdf-lib';

import {
  documentDateTime,
  documentMoney,
  pdfText,
  renderTicketPdf,
  renderVoucherPdf,
} from './booking-pdf';

describe('booking PDFs', () => {
  it('renders an e-ticket receipt', async () => {
    const bytes = await renderTicketPdf({
      reference: 'K7QWPM',
      airlineReference: 'RZPNXB',
      issuedAt: new Date('2026-10-01T10:00:00Z'),
      airline: { code: 'BA', name: 'British Airways' },
      passengers: [
        {
          surname: 'OKAFOR',
          givenNames: 'ADEBAYO CHIOMA',
          title: 'ms',
          type: 'adult',
          ticketNumber: '1251234567890',
          extraBags: 1,
        },
      ],
      slices: [
        {
          origin: { code: 'LOS', name: 'Murtala Muhammed', cityName: 'Lagos' },
          destination: { code: 'LHR', name: 'Heathrow', cityName: 'London' },
          departureLocal: '2026-12-10T22:30',
          arrivalLocal: '2026-12-11T05:10',
          arrivalDayOffset: 1,
          durationMinutes: 400,
          segments: [
            {
              flightNumber: '74',
              carrierCode: 'BA',
              originCode: 'LOS',
              destinationCode: 'LHR',
              departureLocal: '2026-12-10T22:30',
              arrivalLocal: '2026-12-11T05:10',
              cabinClass: 'economy',
            },
          ],
        },
      ],
      baggage: { carryOn: 1, checked: 1 },
      conditions: { refundable: false, changeable: true },
      total: money(165_385_000n, 'NGN'),
    });
    const pdf = await PDFDocument.load(bytes);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('E-ticket receipt K7QWPM');
  });

  it('renders a hotel voucher', async () => {
    const bytes = await renderVoucherPdf({
      reference: 'K7QWPM',
      confirmationNumber: 'MH12AB34CD',
      issuedAt: new Date('2026-10-01T10:00:00Z'),
      hotel: {
        name: 'The Palm Suites',
        stars: 4,
        area: 'Jumeirah',
        cityName: 'Dubai',
        countryCode: 'AE',
      },
      checkIn: '2026-12-10',
      checkOut: '2026-12-13',
      nights: 3,
      roomName: 'Deluxe King Room',
      board: 'breakfast_included',
      rooms: 1,
      guests: ['NGOZI EZE'],
      refundable: true,
      freeCancellationUntil: new Date('2026-12-08T12:00:00Z'),
      payAtProperty: money(4_500n, 'USD'),
      total: money(54_000n, 'USD'),
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe('Hotel voucher K7QWPM');
  });

  it('keeps text inside the standard fonts and formats money and dates', () => {
    expect(pdfText('São Paulo → Adébáyọ̀ ₦')).toBe('Sao Paulo ? Adebayo ?');
    expect(documentMoney(money(165_385_000n, 'NGN'))).toBe('NGN 1,653,850.00');
    expect(documentMoney(money(12_345n, 'USD'))).toBe('USD 123.45');
    expect(documentDateTime('2026-12-10T08:30')).toBe('Thu, 10 Dec 2026 08:30');
    expect(documentDateTime('2026-12-10')).toBe('Thu, 10 Dec 2026');
  });
});
