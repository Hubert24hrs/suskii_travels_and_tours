import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DocumentsModule } from '../documents/documents.module';

import { AccountDeletionService } from './account-deletion.service';
import { AdminPrivacyController } from './admin-privacy.controller';
import { CookieConsentController } from './cookie-consent.controller';
import { DataExportService } from './data-export.service';
import { InternalRetentionController } from './internal-retention.controller';
import { PrivacyBreachesService } from './privacy-breaches.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyRequestsService } from './privacy-requests.service';
import { RetentionService } from './retention.service';

/**
 * Data export and account deletion (phase 9, ADR-029), the retention sweep (ADR-039), cookie
 * consent records (ADR-042) and the data rights request and breach registers (ADR-089).
 */
@Module({
  imports: [AuthModule, AccountsModule, BookingsModule, DocumentsModule],
  controllers: [
    PrivacyController,
    CookieConsentController,
    InternalRetentionController,
    AdminPrivacyController,
  ],
  providers: [
    DataExportService,
    AccountDeletionService,
    RetentionService,
    PrivacyRequestsService,
    PrivacyBreachesService,
  ],
  exports: [PrivacyRequestsService, PrivacyBreachesService],
})
export class PrivacyModule {}
