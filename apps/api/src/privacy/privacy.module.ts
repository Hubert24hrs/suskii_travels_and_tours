import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DocumentsModule } from '../documents/documents.module';

import { AccountDeletionService } from './account-deletion.service';
import { DataExportService } from './data-export.service';
import { PrivacyController } from './privacy.controller';

/** Data export and account deletion (phase 9, ADR-029). */
@Module({
  imports: [AuthModule, AccountsModule, BookingsModule, DocumentsModule],
  controllers: [PrivacyController],
  providers: [DataExportService, AccountDeletionService],
})
export class PrivacyModule {}
