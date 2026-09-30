import { color as tokenColor } from '@suskii/design-tokens';
import { currencyExponent, toDecimalString, type Money, type PassengerType } from '@suskii/shared';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { encode } from 'uqr';

// Documents are generated in English for now (localised documents arrive with the notification
// templates). Names use the passport form, which keeps every glyph inside the standard fonts.

export interface TicketDocument {
  reference: string;
  airlineReference: string;
  issuedAt: Date;
  airline: { code: string; name: string };
  passengers: {
    surname: string;
    givenNames: string;
    title: string | null;
    type: PassengerType;
    ticketNumber: string | null;
    extraBags: number;
  }[];
  slices: {
    origin: { code: string; name: string | null; cityName: string | null };
    destination: { code: string; name: string | null; cityName: string | null };
    departureLocal: string;
    arrivalLocal: string;
    arrivalDayOffset: number;
    durationMinutes: number;
    segments: {
      flightNumber: string;
      carrierCode: string;
      originCode: string;
      destinationCode: string;
      departureLocal: string;
      arrivalLocal: string;
      cabinClass: string;
    }[];
  }[];
  baggage: { carryOn: number; checked: number };
  conditions: { refundable: boolean; changeable: boolean };
  total: Money;
}

export interface VoucherDocument {
  reference: string;
  confirmationNumber: string;
  issuedAt: Date;
  hotel: {
    name: string;
    stars: number;
    area: string | null;
    cityName: string;
    countryCode: string;
  };
  checkIn: string;
  checkOut: string;
  nights: number;
  roomName: string;
  board: string;
  rooms: number;
  guests: string[];
  refundable: boolean;
  freeCancellationUntil: Date | null;
  payAtProperty: Money | null;
  total: Money;
}

/** Package, tour and add-on vouchers (ADR-028). */
export interface InhouseVoucherDocument {
  kind: 'package' | 'tour' | 'addon';
  reference: string;
  /** Grouped voucher code; tours also print it as a QR code (`qrPayload`). */
  voucherCode: string;
  qrPayload: string | null;
  issuedAt: Date;
  title: string;
  sample: boolean;
  place: string | null;
  /** Lines such as "Starts: Sat, 12 Dec 2026 09:00" (label, value). */
  when: [string, string][];
  meetingPoint: { name: string; address: string; notes: string | null } | null;
  travellers: string[];
  inclusions: string[];
  cancellation: string[];
  total: Money;
}

export interface VisaConfirmationDocument {
  reference: string;
  issuedAt: Date;
  title: string;
  sample: boolean;
  destination: string;
  purpose: string;
  travelDate: string;
  processingDays: string;
  applicants: string[];
  governmentFeeNote: string | null;
  disclaimer: string;
  total: Money;
}

const PAGE: [number, number] = [595.28, 841.89]; // A4 in points
const MARGIN = 48;

function hexColor(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

const INK = hexColor(tokenColor.foreground);
const MUTED = hexColor(tokenColor.muted);
const BRAND = hexColor(tokenColor.primary);
const RULE = hexColor(tokenColor.border);

/** Standard PDF fonts cover WinAnsi only: strip accents, replace anything else. */
export function pdfText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

export function documentMoney(amount: Money): string {
  const digits = currencyExponent(amount.currency);
  const formatted = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toDecimalString(amount) as Intl.StringNumericLiteral);
  return `${amount.currency} ${formatted}`;
}

/** "2026-12-10T08:30" (local wall time) to "Thu, 10 Dec 2026 08:30". */
export function documentDateTime(local: string): string {
  const date = new Date(`${local.length === 10 ? `${local}T00:00` : local}:00Z`);
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return local.length === 10 ? day : `${day} ${local.slice(11, 16)}`;
}

const duration = (minutes: number): string => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

class Writer {
  private y = PAGE[1] - MARGIN;

  constructor(
    private readonly page: PDFPage,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {}

  text(value: string, options: { size?: number; bold?: boolean; color?: RGB; x?: number } = {}) {
    const size = options.size ?? 10;
    this.page.drawText(pdfText(value), {
      x: options.x ?? MARGIN,
      y: this.y - size,
      size,
      font: options.bold ? this.bold : this.regular,
      color: options.color ?? INK,
    });
  }

  line(value: string, options: { size?: number; bold?: boolean; color?: RGB } = {}) {
    this.text(value, options);
    this.y -= (options.size ?? 10) + 6;
  }

  /** Label and value columns on one row. */
  pair(label: string, value: string) {
    this.text(label, { color: MUTED });
    this.text(value, { x: MARGIN + 150, bold: true });
    this.y -= 16;
  }

  heading(value: string) {
    this.gap(8);
    this.line(value.toUpperCase(), { size: 9, bold: true, color: BRAND });
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 2 },
      end: { x: PAGE[0] - MARGIN, y: this.y + 2 },
      thickness: 0.5,
      color: RULE,
    });
    this.gap(6);
  }

  gap(points: number) {
    this.y -= points;
  }

  /** A QR code of `value` in the top-right corner. */
  qr(value: string) {
    const { data, size } = encode(value);
    const module = 3;
    const left = PAGE[0] - MARGIN - size * module;
    const top = PAGE[1] - MARGIN;
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) {
          this.page.drawRectangle({
            x: left + x * module,
            y: top - (y + 1) * module,
            width: module,
            height: module,
            color: INK,
          });
        }
      }),
    );
  }
}

async function newDocument(title: string, reference: string, qrValue: string = reference) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} ${reference}`);
  pdf.setAuthor('Suskii Travels and Tour');
  pdf.setCreator('Suskii Travels');
  const page = pdf.addPage(PAGE);
  const writer = new Writer(
    page,
    await pdf.embedFont(StandardFonts.Helvetica),
    await pdf.embedFont(StandardFonts.HelveticaBold),
  );
  writer.qr(qrValue);
  writer.line('Suskii Travels', { size: 18, bold: true, color: BRAND });
  writer.line(title, { size: 12, bold: true });
  writer.gap(6);
  return { pdf, writer };
}

export async function renderTicketPdf(ticket: TicketDocument): Promise<Uint8Array> {
  const { pdf, writer } = await newDocument('E-ticket receipt', ticket.reference);
  writer.pair('Suskii reference', ticket.reference);
  writer.pair('Airline reference (PNR)', ticket.airlineReference);
  writer.pair('Airline', `${ticket.airline.name} (${ticket.airline.code})`);
  writer.pair('Issued', ticket.issuedAt.toISOString().slice(0, 10));

  writer.heading('Passengers');
  for (const passenger of ticket.passengers) {
    const name = `${passenger.surname}/${passenger.givenNames}${passenger.title ? ` ${passenger.title.toUpperCase()}` : ''}`;
    const bags = passenger.extraBags > 0 ? `, +${passenger.extraBags} bag` : '';
    writer.pair(name, `${passenger.ticketNumber ?? 'Ticket pending'} (${passenger.type}${bags})`);
  }

  writer.heading('Itinerary');
  for (const slice of ticket.slices) {
    const plusDays = slice.arrivalDayOffset > 0 ? ` (+${slice.arrivalDayOffset})` : '';
    writer.line(
      `${slice.origin.cityName ?? slice.origin.code} (${slice.origin.code}) to ${slice.destination.cityName ?? slice.destination.code} (${slice.destination.code})`,
      { bold: true },
    );
    writer.line(
      `${documentDateTime(slice.departureLocal)} to ${slice.arrivalLocal.slice(11, 16)}${plusDays}, ${duration(slice.durationMinutes)}`,
      { color: MUTED },
    );
    for (const segment of slice.segments) {
      writer.line(
        `${segment.carrierCode} ${segment.flightNumber}   ${segment.originCode} ${segment.departureLocal.slice(11, 16)}  to  ${segment.destinationCode} ${segment.arrivalLocal.slice(11, 16)}   ${segment.cabinClass.replace('_', ' ')}`,
      );
    }
    writer.gap(4);
  }

  writer.heading('Fare');
  writer.pair(
    'Baggage per adult',
    `${ticket.baggage.carryOn} cabin bag, ${ticket.baggage.checked} checked bag`,
  );
  writer.pair('Changes', ticket.conditions.changeable ? 'Allowed (fees may apply)' : 'Not allowed');
  writer.pair(
    'Refunds',
    ticket.conditions.refundable ? 'Allowed (fees may apply)' : 'Non-refundable',
  );
  writer.pair('Total paid', documentMoney(ticket.total));

  writer.heading('Before you fly');
  writer.line('Check in with the airline using the airline reference above.');
  writer.line('Bring the passport or ID used for this booking. Times are local to each airport.');
  return pdf.save();
}

export async function renderVoucherPdf(voucher: VoucherDocument): Promise<Uint8Array> {
  const { pdf, writer } = await newDocument('Hotel voucher', voucher.reference);
  writer.pair('Suskii reference', voucher.reference);
  writer.pair('Hotel confirmation', voucher.confirmationNumber);
  writer.pair('Issued', voucher.issuedAt.toISOString().slice(0, 10));

  writer.heading('Stay');
  writer.line(`${voucher.hotel.name} (${voucher.hotel.stars} stars)`, { size: 12, bold: true });
  writer.line(
    [voucher.hotel.area, voucher.hotel.cityName, voucher.hotel.countryCode]
      .filter(Boolean)
      .join(', '),
    { color: MUTED },
  );
  writer.gap(4);
  writer.pair('Check-in', documentDateTime(voucher.checkIn));
  writer.pair('Check-out', documentDateTime(voucher.checkOut));
  writer.pair('Nights', String(voucher.nights));
  writer.pair('Room', `${voucher.rooms} x ${voucher.roomName}`);
  writer.pair('Meals', voucher.board.replaceAll('_', ' '));

  writer.heading('Guests');
  voucher.guests.forEach((guest, index) => writer.pair(`Room ${index + 1}`, guest));

  writer.heading('Payment and cancellation');
  writer.pair('Total paid', documentMoney(voucher.total));
  if (voucher.payAtProperty)
    writer.pair('Pay at the property', documentMoney(voucher.payAtProperty));
  writer.pair(
    'Cancellation',
    voucher.refundable && voucher.freeCancellationUntil
      ? `Free until ${voucher.freeCancellationUntil.toISOString().slice(0, 16).replace('T', ' ')} UTC`
      : 'Non-refundable',
  );
  writer.heading('At the hotel');
  writer.line("Show this voucher and the lead guest's ID at check-in.");
  return pdf.save();
}

const VOUCHER_TITLES: Record<InhouseVoucherDocument['kind'], string> = {
  package: 'Package voucher',
  tour: 'Tour voucher',
  addon: 'Add-on voucher',
};

const SAMPLE_NOTE = 'SAMPLE: demonstration inventory, not a real booking.';

export async function renderInhouseVoucherPdf(
  voucher: InhouseVoucherDocument,
): Promise<Uint8Array> {
  const { pdf, writer } = await newDocument(
    VOUCHER_TITLES[voucher.kind],
    voucher.reference,
    voucher.qrPayload ?? voucher.reference,
  );
  if (voucher.sample) writer.line(SAMPLE_NOTE, { bold: true, color: MUTED });
  writer.pair('Suskii reference', voucher.reference);
  writer.pair('Voucher code', voucher.voucherCode);
  writer.pair('Issued', voucher.issuedAt.toISOString().slice(0, 10));

  writer.heading(
    voucher.kind === 'tour' ? 'Tour' : voucher.kind === 'package' ? 'Package' : 'Add-on',
  );
  writer.line(voucher.title, { size: 12, bold: true });
  if (voucher.place) writer.line(voucher.place, { color: MUTED });
  writer.gap(4);
  for (const [label, value] of voucher.when) writer.pair(label, value);
  if (voucher.meetingPoint) {
    writer.heading('Meeting point');
    writer.line(voucher.meetingPoint.name, { bold: true });
    writer.line(voucher.meetingPoint.address);
    if (voucher.meetingPoint.notes) writer.line(voucher.meetingPoint.notes, { color: MUTED });
  }

  writer.heading('Travellers');
  voucher.travellers.forEach((name, index) => writer.pair(`Traveller ${index + 1}`, name));
  if (voucher.inclusions.length > 0) {
    writer.heading('Included');
    for (const line of voucher.inclusions.slice(0, 12)) writer.line(`- ${line}`);
  }
  writer.heading('Payment and cancellation');
  writer.pair('Total paid', documentMoney(voucher.total));
  for (const line of voucher.cancellation) writer.line(line);
  writer.heading('On the day');
  writer.line(
    voucher.kind === 'tour'
      ? 'Show this voucher (the QR code or the voucher code) and an ID to your guide.'
      : 'Show this voucher and an ID. Our team contacts you with any partner details.',
  );
  return pdf.save();
}

export async function renderVisaConfirmationPdf(
  confirmation: VisaConfirmationDocument,
): Promise<Uint8Array> {
  const { pdf, writer } = await newDocument('Visa assistance confirmation', confirmation.reference);
  if (confirmation.sample) writer.line(SAMPLE_NOTE, { bold: true, color: MUTED });
  writer.pair('Suskii reference', confirmation.reference);
  writer.pair('Issued', confirmation.issuedAt.toISOString().slice(0, 10));

  writer.heading('Service');
  writer.line(confirmation.title, { size: 12, bold: true });
  writer.pair('Destination', confirmation.destination);
  writer.pair('Purpose', confirmation.purpose);
  writer.pair('Travel date', documentDateTime(confirmation.travelDate));
  writer.pair('Processing time', confirmation.processingDays);

  writer.heading('Applicants');
  confirmation.applicants.forEach((name, index) => writer.pair(`Applicant ${index + 1}`, name));

  writer.heading('Payment');
  writer.pair('Service fee paid', documentMoney(confirmation.total));
  if (confirmation.governmentFeeNote) writer.line(confirmation.governmentFeeNote);

  writer.heading('Next steps');
  writer.line('Upload the documents on your checklist from your booking page, then submit.');
  writer.line('Our visa officers review them and tell you if anything else is needed.');
  writer.heading('Important');
  for (const line of wrap(confirmation.disclaimer, 95)) writer.line(line);
  return pdf.save();
}

/** Word wrap for the fixed-width body text of these documents. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
