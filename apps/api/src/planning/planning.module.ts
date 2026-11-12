import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';

import { TripPlanningController } from './trip-planning.controller';
import { TripPlanningService } from './trip-planning.service';

/** Cars features built on bookings (P9): departure planner and trip bundling. */
@Module({
  imports: [BookingsModule],
  controllers: [TripPlanningController],
  providers: [TripPlanningService],
})
export class PlanningModule {}
