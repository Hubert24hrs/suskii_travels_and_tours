import { Global, Module, type DynamicModule } from '@nestjs/common';

import { APP_CONFIG, loadConfig, type AppConfig } from './config';

@Global()
@Module({})
export class ConfigModule {
  /** Pass an explicit config in tests; production reads and validates `process.env`. */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => config ?? loadConfig() }],
      exports: [APP_CONFIG],
    };
  }
}
