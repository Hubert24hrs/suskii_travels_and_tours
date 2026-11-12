import { Module } from '@nestjs/common';

import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

/** Account preferences and notification choices (phase 9, ADR-032). */
@Module({
  controllers: [PreferencesController],
  providers: [PreferencesService],
  exports: [PreferencesService],
})
export class AccountsModule {}
