import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DriversModule } from '../drivers/drivers.module';
import { PaymentsModule } from '../payments/payments.module';

import { AdminFinanceController } from './admin-finance.controller';
import { DriverPayoutsService } from './driver-payouts.service';
import { FinanceAdminService } from './finance-admin.service';
import { InternalFinanceController } from './internal-finance.controller';
import { LedgerReconciliationService } from './ledger-reconciliation.service';

/** Ledger reconciliation and driver payouts (Cars P6, ADR-051). */
@Module({
  imports: [AuthModule, BookingsModule, PaymentsModule, DriversModule],
  controllers: [AdminFinanceController, InternalFinanceController],
  providers: [LedgerReconciliationService, DriverPayoutsService, FinanceAdminService],
})
export class FinanceModule {}
