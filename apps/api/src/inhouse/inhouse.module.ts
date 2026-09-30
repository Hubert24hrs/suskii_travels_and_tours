import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';

import { AddonLinksService } from './addon-links.service';
import { AdminCatalogController } from './admin-catalog.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { InhouseCatalogService } from './inhouse-catalog.service';
import { InhouseController } from './inhouse.controller';
import { InhouseQuotesService } from './inhouse-quotes.service';
import { VouchersService } from './vouchers.service';

/** Packages, tours and add-ons: catalog, quotes, add-on links, vouchers (phase 8, ADR-025). */
@Module({
  imports: [AuthModule, BookingsModule],
  controllers: [InhouseController, AdminCatalogController],
  providers: [
    InhouseCatalogService,
    InhouseQuotesService,
    AddonLinksService,
    CatalogAdminService,
    VouchersService,
  ],
  exports: [InhouseQuotesService],
})
export class InhouseModule {}
