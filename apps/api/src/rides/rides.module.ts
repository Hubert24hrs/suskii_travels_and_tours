import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';

import { AdminRidesController } from './admin-rides.controller';
import { DriverRoadController } from './driver-road.controller';
import { InternalRidesController } from './internal-rides.controller';
import { RideDispatchService } from './ride-dispatch.service';
import { RideDriverService } from './ride-driver.service';
import { RideEventsPublisher } from './ride-events.publisher';
import { RideRealtimeGateway } from './ride-realtime.gateway';
import { RideSettlementService } from './ride-settlement.service';
import { RideTransitions } from './ride-transitions';
import { RidesAdminService } from './rides-admin.service';
import { RidesCatalogService } from './rides-catalog.service';
import {
  EmergencyContactsController,
  RidesController,
  SharedRidesController,
} from './rides.controller';
import { RidesService } from './rides.service';
import { SafetyService } from './safety.service';

/** Intrastate rides (Cars P4, ADR-049 to ADR-053). */
@Module({
  imports: [AuthModule, BookingsModule],
  controllers: [
    RidesController,
    SharedRidesController,
    EmergencyContactsController,
    DriverRoadController,
    AdminRidesController,
    InternalRidesController,
  ],
  providers: [
    RidesCatalogService,
    RidesService,
    RideTransitions,
    RideSettlementService,
    RideEventsPublisher,
    RideDriverService,
    RideDispatchService,
    RideRealtimeGateway,
    RidesAdminService,
    SafetyService,
  ],
  exports: [RidesCatalogService, RideTransitions, RideEventsPublisher, SafetyService],
})
export class RidesModule {}
