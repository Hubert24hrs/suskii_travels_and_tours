import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { PrismaService } from './prisma.service';

/** DI token for the shared ioredis client. */
export const REDIS = Symbol('REDIS');

@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}

/** Database and Redis clients, available everywhere. Both connect lazily. */
@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Redis(config.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          connectTimeout: 5000,
        }),
    },
    RedisShutdown,
  ],
  exports: [PrismaService, REDIS],
})
export class InfraModule {}
