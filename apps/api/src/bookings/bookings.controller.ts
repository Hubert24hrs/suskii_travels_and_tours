import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { requestContext } from '../common/request-context';
import { Contract, fileResponse } from '../contract/contract';
import { BOOKING_LIMITS, RateLimit, SEARCH_LIMITS } from '../rate-limit/rate-limit.decorator';
import { clientContext } from '../search/client-context';

import { BookingDocumentsService } from './booking-documents.service';
import {
  BOOKING_TOKEN_HEADER,
  bookingIdParamsSchema,
  bookingSchema,
  createBookingRequestSchema,
  createdBookingSchema,
  documentParamsSchema,
  paymentSessionSchema,
  priceConsentRequestSchema,
  quoteIdParamsSchema,
  quoteSchema,
  startPaymentRequestSchema,
  type CreateBookingRequest,
  type StartPaymentRequest,
} from './bookings.schemas';
import { BookingsService, type BookingCaller } from './bookings.service';
import { CheckoutService } from './checkout.service';
import { PaymentPlansService } from './payment-plans.service';
import { QuotesService } from './quotes.service';

const TAGS = ['Bookings'];

function caller(request: AuthenticatedRequest): BookingCaller {
  const header = request.headers['x-booking-token'];
  const token = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
  return {
    client: clientContext(request),
    context: requestContext(request),
    token: token.length > 0 && token.length <= 128 ? token : null,
  };
}

/**
 * Checkout and booking routes (ADR-014, ADR-015). Guests and signed-in travellers both book;
 * guests reach their booking with the access token returned at creation.
 */
@Public()
@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly checkout: CheckoutService,
    private readonly quotes: QuotesService,
    private readonly documents: BookingDocumentsService,
    private readonly plans: PaymentPlansService,
  ) {}

  @Get('quotes/:quoteId')
  @RateLimit(SEARCH_LIMITS.quoteIp)
  @Contract({
    operationId: 'getQuote',
    summary: 'A quote to check out from',
    description:
      'Priced for the caller. An expired quote answers 410 with the original search request.',
    tags: TAGS,
    params: quoteIdParamsSchema,
    responses: { 200: quoteSchema },
    errors: [404, 410],
  })
  quote(
    @Param('quoteId') quoteId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof quoteSchema>> {
    return this.quotes.get(quoteId, clientContext(request));
  }

  @Post('bookings')
  @RateLimit(BOOKING_LIMITS.createIp, BOOKING_LIMITS.createUser)
  @Contract({
    operationId: 'createBooking',
    summary: 'Book a quote',
    description:
      'Validates travellers against the offer and itinerary (422 `passengers-invalid` with issue codes), prices extras and the promo code, and creates the booking as PRICED. Guests must send a Turnstile token and receive a one-time access token.',
    tags: TAGS,
    body: createBookingRequestSchema,
    responses: { 201: createdBookingSchema },
    errors: [404, 409, 410, 422],
    idempotent: true,
  })
  create(
    @Body() body: CreateBookingRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof createdBookingSchema>> {
    return this.bookings.create(body, caller(request));
  }

  @Get('bookings/:bookingId')
  @Contract({
    operationId: 'getBooking',
    summary: 'A booking',
    description: 'Poll while the status is AWAITING_PAYMENT, PAID or TICKETING.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: bookingSchema },
    errors: [404],
  })
  get(
    @Param('bookingId') bookingId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof bookingSchema>> {
    return this.bookings.get(bookingId, caller(request));
  }

  @Post('bookings/:bookingId/payments')
  @RateLimit(BOOKING_LIMITS.paymentIp)
  @Contract({
    operationId: 'startBookingPayment',
    summary: 'Re-check the price and open a hosted checkout (or pay from the wallet)',
    description:
      'Re-prices with the supplier first. A changed total answers 409 `price-changed` with `priceChange` (previous, current, difference, price); accept it with `price-consent`, then call this again. An offer that sold out answers 410 with the original search. Payment plans pay the next installment unless `installmentId` or `payInFull` says otherwise. `provider` picks one of `paymentOptions.providers` (422 when it cannot take this currency); `useWallet` pays at once when the wallet covers the amount (409 `wallet-insufficient` otherwise).',
    tags: TAGS,
    params: bookingIdParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    body: startPaymentRequestSchema,
    responses: { 201: paymentSessionSchema },
    errors: [404, 409, 410, 422, 503],
    idempotent: true,
  })
  pay(
    @Param('bookingId') bookingId: string,
    @Body() body: StartPaymentRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof paymentSessionSchema>> {
    return this.checkout.startPayment(bookingId, caller(request), body);
  }

  @Post('bookings/:bookingId/hold')
  @HttpCode(HttpStatus.OK)
  @RateLimit(BOOKING_LIMITS.holdIp)
  @Contract({
    operationId: 'holdBooking',
    summary: 'Reserve now, pay later',
    description:
      'Holds the seats with the airline until `paymentOptions.hold.deadline` (flights whose fare allows it, without paid extras). Re-checks the price first (409 `price-changed`). 409 `hold-unavailable` when the airline will not hold it, `hold-limit` with too many unpaid reservations. Tickets are issued only after full payment.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: bookingSchema },
    errors: [404, 409, 410, 503],
    idempotent: true,
  })
  hold(
    @Param('bookingId') bookingId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof bookingSchema>> {
    return this.plans.create(bookingId, caller(request), 'hold');
  }

  @Post('bookings/:bookingId/installment-plan')
  @HttpCode(HttpStatus.OK)
  @RateLimit(BOOKING_LIMITS.holdIp)
  @Contract({
    operationId: 'createInstallmentPlan',
    summary: 'Pay in installments',
    description:
      'Holds the seats and sets up the schedule from `paymentOptions.installments`; then pay the deposit with `payments`. If the deposit is not paid within the checkout window the hold is released. Tickets are issued after the last installment.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: bookingSchema },
    errors: [404, 409, 410, 503],
    idempotent: true,
  })
  installments(
    @Param('bookingId') bookingId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof bookingSchema>> {
    return this.plans.create(bookingId, caller(request), 'installments');
  }

  @Post('bookings/:bookingId/price-consent')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'consentToBookingPrice',
    summary: 'Accept a changed price',
    description: 'Send the new total exactly as shown; if it moved again the answer is 409.',
    tags: TAGS,
    params: bookingIdParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    body: priceConsentRequestSchema,
    responses: { 200: bookingSchema },
    errors: [404, 409],
  })
  consent(
    @Param('bookingId') bookingId: string,
    @Body() body: z.infer<typeof priceConsentRequestSchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof bookingSchema>> {
    return this.bookings.consent(bookingId, body.total, caller(request));
  }

  @Post('bookings/:bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'cancelBooking',
    summary: 'Cancel an unpaid or partly paid booking',
    description:
      'A reservation is released at the airline. A partly paid plan is refunded per its policy (`paymentPlan.defaultFeeBps`).',
    tags: TAGS,
    params: bookingIdParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: bookingSchema },
    errors: [404, 409],
  })
  cancel(
    @Param('bookingId') bookingId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof bookingSchema>> {
    return this.plans.cancel(bookingId, caller(request));
  }

  @Get('bookings/:bookingId/documents/:documentId')
  @Contract({
    operationId: 'downloadBookingDocument',
    summary: 'Download an e-ticket or hotel voucher (PDF)',
    tags: TAGS,
    params: documentParamsSchema,
    headers: [BOOKING_TOKEN_HEADER],
    responses: { 200: fileResponse('application/pdf') },
    errors: [404],
  })
  async document(
    @Param('bookingId') bookingId: string,
    @Param('documentId') documentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const booking = await this.bookings.load(bookingId, caller(request));
    const { fileName, bytes } = await this.documents.read(booking, documentId);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      length: bytes.byteLength,
    });
  }
}
