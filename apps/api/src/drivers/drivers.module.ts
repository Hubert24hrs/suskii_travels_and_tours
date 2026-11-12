import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { VisaModule } from '../visa/visa.module';

import { AdminDriversController } from './admin-drivers.controller';
import { DriverDocumentsService } from './driver-documents.service';
import { DriversController } from './drivers.controller';
import { DriversAdminService } from './drivers-admin.service';
import { DriversService } from './drivers.service';
import { InternalDriversController } from './internal-drivers.controller';

/** Driver onboarding and review (Cars P4, ADR-050). */
@Module({
  imports: [AuthModule, DocumentsModule, VisaModule],
  controllers: [DriversController, AdminDriversController, InternalDriversController],
  providers: [DriversService, DriverDocumentsService, DriversAdminService],
  exports: [DriversService, DriverDocumentsService],
})
export class DriversModule {}
