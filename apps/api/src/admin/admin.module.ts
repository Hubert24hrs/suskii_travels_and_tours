import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';

import { AdminAuditController } from './admin-audit.controller';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminContentController } from './admin-content.controller';
import { AdminContentService } from './admin-content.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDealsController } from './admin-deals.controller';
import { AdminDealsService } from './admin-deals.service';
import { AdminPricingController } from './admin-pricing.controller';
import { AdminPricingService } from './admin-pricing.service';
import { AdminPromosController } from './admin-promos.controller';
import { AdminPromosService } from './admin-promos.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * The staff API behind the admin console (phase 10, ADR-033 to ADR-036). Every route is an
 * `@AdminRoute` under /v1/admin; every mutation declares the audit actions it records.
 */
@Module({
  imports: [AuthModule, BookingsModule],
  controllers: [
    AdminDashboardController,
    AdminBookingsController,
    AdminUsersController,
    AdminAuditController,
    AdminPricingController,
    AdminPromosController,
    AdminDealsController,
    AdminContentController,
  ],
  providers: [
    AdminDashboardService,
    AdminBookingsService,
    AdminUsersService,
    AdminPricingService,
    AdminPromosService,
    AdminDealsService,
    AdminContentService,
  ],
})
export class AdminModule {}
