import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DocumentsModule } from '../documents/documents.module';

import { AccountDeletionService } from './account-deletion.service';
import { CookieConsentController } from './cookie-consent.controller';
import { DataExportService } from './data-export.service';
import { InternalRetentionController } from './internal-retention.controller';
import { PrivacyController } from './privacy.controller';
import { RetentionService } from './retention.service';

/**
 * Data export and account deletion (phase 9, ADR-029), the retention sweep (ADR-039) and cookie
 * consent records (ADR-042).
 */
@Module({
  imports: [AuthModule, AccountsModule, BookingsModule, DocumentsModule],
  controllers: [PrivacyController, CookieConsentController, InternalRetentionController],
  providers: [DataExportService, AccountDeletionService, RetentionService],
})
export class PrivacyModule {}
