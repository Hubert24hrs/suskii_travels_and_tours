import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';

import { AdminAssistedQuotesController } from './admin-assisted-quotes.controller';
import { AssistedQuotesController, MyAssistedQuotesController } from './assisted-quotes.controller';
import { AssistedQuotesService } from './assisted-quotes.service';

/**
 * Assisted quotes (ADR-104): the request, the staff queue and the offer. The booking itself is
 * the ordinary pipeline's; this module only makes the offer and records what staff did by hand.
 */
@Module({
  imports: [BookingsModule],
  controllers: [
    AssistedQuotesController,
    MyAssistedQuotesController,
    AdminAssistedQuotesController,
  ],
  providers: [AssistedQuotesService],
  exports: [AssistedQuotesService],
})
export class AssistedQuotesModule {}
