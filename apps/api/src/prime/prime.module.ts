import { Module } from '@nestjs/common';

import { AdminPrimeController, PrimeController } from './prime.controller';
import { PrimeService } from './prime.service';

/** Suskii Prime plans and membership status (phase 9, ADR-030). Purchases are bookings. */
@Module({
  controllers: [PrimeController, AdminPrimeController],
  providers: [PrimeService],
  exports: [PrimeService],
})
export class PrimeModule {}
