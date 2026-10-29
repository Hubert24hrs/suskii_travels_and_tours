import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';

import { AdminCompaniesController } from './admin-companies.controller';
import { AdminCompaniesService } from './admin-companies.service';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyTripsService } from './company-trips.service';
import { CompanyWalletService } from './company-wallet.service';

/**
 * Company accounts (ADR-078): members, invitations, the travel policy, approvals and reports,
 * and the company wallet (ADR-090).
 * Booking creation checks the policy through `CompanyPolicyEvaluator`, which `BookingsModule`
 * provides itself so the two modules do not depend on each other both ways.
 */
@Module({
  imports: [BookingsModule, PaymentsModule],
  controllers: [CompaniesController, AdminCompaniesController],
  providers: [CompaniesService, CompanyTripsService, CompanyWalletService, AdminCompaniesService],
})
export class CompaniesModule {}
