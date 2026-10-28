import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';

import { AdminSupportController } from './admin-support.controller';
import { SupportAccess } from './support-access';
import { SupportAdminService } from './support-admin.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Support conversations: travellers, guests and visitors, and the console inbox (ADR-083). */
@Module({
  imports: [BookingsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, SupportAdminService, SupportAccess],
})
export class SupportModule {}
