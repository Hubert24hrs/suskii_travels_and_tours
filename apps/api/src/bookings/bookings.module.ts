import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PaymentsModule } from '../payments/payments.module';
import { SearchModule } from '../search/search.module';
import { SuppliersModule } from '../suppliers/suppliers.module';

import { AdminRefundsController } from './admin-refunds.controller';
import { BookingAccessLinks } from './booking-access-links';
import { BookingCancellationService } from './booking-cancellation.service';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingFundsService } from './booking-funds.service';
import { BookingNotesService } from './booking-notes.service';
import { AdminPaymentReviewsController } from './admin-payment-reviews.controller';
import { BookingNotifications } from './booking-notifications';
import { BookingPaymentsService } from './booking-payments.service';
import { BookingTransitions } from './booking-transitions';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CheckoutService } from './checkout.service';
import { InhouseCatalog } from './inhouse-catalog';
import { InhouseFulfilment } from './inhouse-fulfilment';
import { InternalBookingsController } from './internal-bookings.controller';
import { MeBookingsController } from './me-bookings.controller';
import { PaymentEventsService } from './payment-events.service';
import { PaymentReviewsService } from './payment-reviews.service';
import { PaymentRiskService } from './payment-risk.service';
import { PaymentPlansService } from './payment-plans.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentsController } from './payments.controller';
import { QuotesService } from './quotes.service';
import { RefundsService } from './refunds.service';
import { TicketingService } from './ticketing.service';
import { TravellersController } from './travellers.controller';
import { TravellersService } from './travellers.service';

/**
 * Checkout, bookings, payments, payment plans, refunds, ticketing, documents and saved travellers
 * (phases 5 and 6).
 */
@Module({
  imports: [AuthModule, SearchModule, SuppliersModule, PaymentsModule, DocumentsModule],
  controllers: [
    BookingsController,
    PaymentsController,
    TravellersController,
    InternalBookingsController,
    AdminRefundsController,
    AdminPaymentReviewsController,
    MeBookingsController,
  ],
  providers: [
    BookingTransitions,
    BookingAccessLinks,
    BookingFundsService,
    BookingsService,
    BookingDocumentsService,
    BookingNotifications,
    RefundsService,
    BookingPaymentsService,
    TicketingService,
    CheckoutService,
    PaymentEventsService,
    PaymentReconciliationService,
    PaymentPlansService,
    QuotesService,
    TravellersService,
    InhouseCatalog,
    InhouseFulfilment,
    BookingCancellationService,
    BookingNotesService,
    PaymentRiskService,
    PaymentReviewsService,
  ],
  exports: [
    BookingNotesService,
    TicketingService,
    CheckoutService,
    RefundsService,
    PaymentPlansService,
    BookingsService,
    BookingTransitions,
    InhouseCatalog,
    QuotesService,
  ],
})
export class BookingsModule {}
