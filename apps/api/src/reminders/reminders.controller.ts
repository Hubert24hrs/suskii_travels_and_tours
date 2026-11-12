import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';

import { Contract, named } from '../contract/contract';
import { InternalRoute } from '../internal/internal-route';

import { RemindersService } from './reminders.service';

const reminderRunSchema = named(
  'ReminderRun',
  z.object({ checkin: z.number().int(), prime: z.number().int() }),
);

/** Worker-only: check-in and Prime expiry reminders. */
@InternalRoute()
@Controller('internal/reminders')
export class InternalRemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'runReminders',
    summary: 'Send due check-in and Suskii Prime reminders',
    tags: ['Internal'],
    responses: { 200: reminderRunSchema },
    errors: [401, 404],
  })
  run(): Promise<z.infer<typeof reminderRunSchema>> {
    return this.reminders.run();
  }
}
