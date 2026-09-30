import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DocumentsModule } from '../documents/documents.module';

import { AdminVisaController } from './admin-visa.controller';
import { AntivirusScanner, ClamAvScanner, MockAntivirusScanner } from './antivirus';
import { InternalVisaController } from './internal-visa.controller';
import { VisaDocumentsService } from './visa-documents.service';
import { VisaController } from './visa.controller';
import { VisaService } from './visa.service';

/** Visa assistance: eligibility, applications and secure documents (phase 8, ADR-026). */
@Module({
  imports: [AuthModule, BookingsModule, DocumentsModule],
  controllers: [VisaController, AdminVisaController, InternalVisaController],
  providers: [
    VisaService,
    VisaDocumentsService,
    MockAntivirusScanner,
    {
      provide: AntivirusScanner,
      inject: [APP_CONFIG, MockAntivirusScanner],
      useFactory: (config: AppConfig, mock: MockAntivirusScanner): AntivirusScanner =>
        config.ANTIVIRUS_PROVIDER === 'clamav'
          ? new ClamAvScanner(config.CLAMAV_HOST, config.CLAMAV_PORT, config.CLAMAV_TIMEOUT_MS)
          : mock,
    },
  ],
})
export class VisaModule {}
