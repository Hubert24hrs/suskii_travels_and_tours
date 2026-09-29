import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { AdminAuditController } from './admin-audit.controller';
import { AdminUsersController } from './admin-users.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController, AdminAuditController],
})
export class AdminModule {}
