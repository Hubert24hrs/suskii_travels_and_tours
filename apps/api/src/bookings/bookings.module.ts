import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PaymentsModule } from '../payments/payments.module';
import { SearchModule } from '../search/search.module';
import { SuppliersModule } from '../suppliers/suppliers.module';

import { BookingDocumentsService } from './booking-documents.service';
import { BookingTransitions } from './booking-transitions';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CheckoutService } from './checkout.service';
import { InternalBookingsController } from './internal-bookings.controller';
import { PaymentEventsService } from './payment-events.service';
import { PaymentsController } from './payments.controller';
import { QuotesService } from './quotes.service';
import { TicketingService } from './ticketing.service';
import { TravellersController } from './travellers.controller';
import { TravellersService } from './travellers.service';

/** Checkout, bookings, payments, ticketing, documents and saved travellers (phase 5). */
@Module({
  imports: [AuthModule, SearchModule, SuppliersModule, PaymentsModule, DocumentsModule],
  controllers: [
    BookingsController,
    PaymentsController,
    TravellersController,
    InternalBookingsController,
  ],
  providers: [
    BookingTransitions,
    BookingsService,
    BookingDocumentsService,
    CheckoutService,
    PaymentEventsService,
    QuotesService,
    TicketingService,
    TravellersService,
  ],
  exports: [TicketingService, CheckoutService],
})
export class BookingsModule {}
