import { Module } from '@nestjs/common';

import {
  AdminReferralsController,
  InternalReferralsController,
  ReferralsController,
} from './referrals.controller';
import { ReferralsService } from './referrals.service';

/** Referral codes, attribution, qualification and rewards (phase 9, ADR-031). */
@Module({
  controllers: [ReferralsController, AdminReferralsController, InternalReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
