import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma client over the node-postgres driver adapter. The pool connects lazily on the first
 * query, so booting the app (e.g. to generate the OpenAPI document) needs no database. Its size
 * is DATABASE_POOL_MAX: node-postgres ignores Prisma's `connection_limit` URL parameter.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        max: config.DATABASE_POOL_MAX,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
