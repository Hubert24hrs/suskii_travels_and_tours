import { Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';

import { PrismaService } from '../infra/prisma.service';

import { syncRbacCatalog } from './rbac-catalog';

@Injectable()
class RbacCatalogSync implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacCatalogSync.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await syncRbacCatalog(this.prisma);
    } catch (error) {
      // Not fatal: /ready reports the database, and the next boot retries.
      this.logger.error({ err: error }, 'RBAC catalog sync failed');
    }
  }
}

@Module({ providers: [RbacCatalogSync] })
export class RbacModule {}
