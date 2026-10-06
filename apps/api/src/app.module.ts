import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';

import { AccountsModule } from './accounts/accounts.module';
import { AdminModule } from './admin/admin.module';
import { AlertsModule } from './alerts/alerts.module';
import { AttestationGuard } from './attestation/attestation.guard';
import { AttestationModule } from './attestation/attestation.module';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { AppVersionGuard } from './common/app-version.guard';
import { ClientCountryMiddleware } from './common/client-country.middleware';
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
import { InhouseModule } from './inhouse/inhouse.module';
import { VisaModule } from './visa/visa.module';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { InfraModule } from './infra/redis';
import { LedgerModule } from './ledger/ledger.module';
import { LoggingModule } from './logging/logging.module';
import { MessagingModule } from './messaging/messaging.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PricingModule } from './pricing/pricing.module';
import { PrimeModule } from './prime/prime.module';
import { PrivacyModule } from './privacy/privacy.module';
import { PushModule } from './push/push.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RbacModule } from './rbac/rbac.module';
import { ReferralsModule } from './referrals/referrals.module';
import { RemindersModule } from './reminders/reminders.module';
import { SearchModule } from './search/search.module';

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClientCountryMiddleware).forRoutes('*');
  }

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
        LedgerModule,
        NotificationsModule,
        PushModule,
        MessagingModule,
        AttestationModule,
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
        BookingsModule,
        InhouseModule,
        VisaModule,
        AccountsModule,
        PrivacyModule,
        PrimeModule,
        AlertsModule,
        ReferralsModule,
        RemindersModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        // Guards run in this order: a retired app version (before anything else), who is
        // calling, how often, what they may do, then (mobile sensitive routes) whether the
        // device is genuine.
        { provide: APP_GUARD, useClass: AppVersionGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useExisting: PermissionsGuard },
        { provide: APP_GUARD, useExisting: AttestationGuard },
        // Interceptors nest in this order: idempotency wraps the contract, so replays return
        // exactly the validated response that was sent the first time.
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
      ],
    };
  }
}
