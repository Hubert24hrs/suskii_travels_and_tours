import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';

import { AdminGroundController } from './admin-ground.controller';
import { BusHoldsService } from './bus-holds.service';
import { BusTicketsService } from './bus-tickets.service';
import { BusesController } from './buses.controller';
import { BusesService } from './buses.service';
import { GroundAdminService } from './ground-admin.service';
import { OperatorController } from './operator.controller';

/** Interstate buses (Cars P3, ADR-049 to ADR-051). */
@Module({
  imports: [BookingsModule],
  controllers: [BusesController, OperatorController, AdminGroundController],
  providers: [BusesService, BusHoldsService, BusTicketsService, GroundAdminService],
  exports: [BusesService, BusHoldsService],
})
export class BusesModule {}
