import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DocumentsModule } from '../documents/documents.module';
import { VisaModule } from '../visa/visa.module';

import { AdminRentalsController } from './admin-rentals.controller';
import { RentalFiles } from './rental-files';
import { RentalsAdminService } from './rentals-admin.service';
import { RentalsCatalogService } from './rentals-catalog.service';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';

/** Car rental (Cars P5, ADR-049, ADR-051). */
@Module({
  imports: [AuthModule, BookingsModule, DocumentsModule, VisaModule],
  controllers: [RentalsController, AdminRentalsController],
  providers: [RentalsCatalogService, RentalsService, RentalsAdminService, RentalFiles],
  exports: [RentalsCatalogService],
})
export class RentalsModule {}
