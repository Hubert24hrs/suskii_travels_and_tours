import { Module } from '@nestjs/common';

import { AdminStatusController } from './admin-status.controller';
import { StatusAdminService } from './status-admin.service';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';

@Module({
  controllers: [StatusController, AdminStatusController],
  providers: [StatusService, StatusAdminService],
})
export class StatusModule {}
