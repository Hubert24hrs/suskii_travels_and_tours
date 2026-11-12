import { Module } from '@nestjs/common';

import { InternalRemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

/** Scheduled check-in and Prime reminders (phase 9, ADR-030, ADR-032). */
@Module({
  controllers: [InternalRemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
