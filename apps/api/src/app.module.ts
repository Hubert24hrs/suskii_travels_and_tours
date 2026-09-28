import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';

import { ProblemDetailsFilter } from './common/problem-details';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { ContractInterceptor } from './contract/contract.interceptor';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/redis';
import { LoggingModule } from './logging/logging.module';

@Module({})
export class AppModule {
  /** `config` is injected by tests; production validates `process.env`. */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        DiscoveryModule,
        LoggingModule,
        InfraModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
      ],
    };
  }
}
