import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';

import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BotProtectionModule } from './bot-protection/bot-protection.module';
import { CatalogModule } from './catalog/catalog.module';
import { ContentModule } from './content/content.module';
import { DealsModule } from './deals/deals.module';
import { PermissionsGuard } from './auth/permissions.guard';
import { ProblemDetailsFilter } from './common/problem-details';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { ContractInterceptor } from './contract/contract.interceptor';
import { CryptoModule } from './crypto/crypto.module';
import { HealthModule } from './health/health.module';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { InfraModule } from './infra/redis';
import { LoggingModule } from './logging/logging.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PricingModule } from './pricing/pricing.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RbacModule } from './rbac/rbac.module';
import { SearchModule } from './search/search.module';

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
        CryptoModule,
        AuditModule,
        NotificationsModule,
        BotProtectionModule,
        RbacModule,
        AuthModule,
        AdminModule,
        CatalogModule,
        PricingModule,
        SearchModule,
        ContentModule,
        DealsModule,
        NewsletterModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        // Guards run in this order: who is calling, how often, then what they may do.
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useExisting: PermissionsGuard },
        // Interceptors nest in this order: idempotency wraps the contract, so replays return
        // exactly the validated response that was sent the first time.
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
      ],
    };
  }
}
