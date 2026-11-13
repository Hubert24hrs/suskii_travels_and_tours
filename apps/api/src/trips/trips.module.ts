import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';

import { TripBookingService } from './trip-booking.service';
import { TripCheckoutService } from './trip-checkout.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

/**
 * Combined trips (ADR-099): groups of a traveller's own bookings, paid with one checkout. The
 * money side (settling each booking's share from the provider's webhook) lives with the payment
 * pipeline in `BookingsModule`.
 */
@Module({
  imports: [BookingsModule, PaymentsModule],
  controllers: [TripsController],
  providers: [TripsService, TripCheckoutService, TripBookingService],
  exports: [TripsService],
})
export class TripsModule {}
