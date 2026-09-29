import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { FlutterwavePaymentProvider } from './flutterwave/flutterwave-payment-provider';
import { MockPaymentProvider } from './mock-payment-provider';
import type { PaymentProvider } from './payment-provider';
import { PAYMENT_PROVIDER_LIST, PaymentProviders } from './payment-providers';
import { PaystackPaymentProvider } from './paystack/paystack-payment-provider';
import { StripePaymentProvider } from './stripe/stripe-payment-provider';

/** Builds the providers listed in PAYMENT_PROVIDERS, in order (ADR-016). */
function providerList(config: AppConfig, mock: MockPaymentProvider): PaymentProvider[] {
  const timeoutMs = config.PAYMENT_PROVIDER_TIMEOUT_MS;
  return config.PAYMENT_PROVIDERS.map((name): PaymentProvider => {
    switch (name) {
      case 'mock':
        return mock;
      case 'paystack':
        return new PaystackPaymentProvider({
          secretKey: config.PAYSTACK_SECRET_KEY ?? '',
          baseUrl: config.PAYSTACK_API_URL,
          timeoutMs,
        });
      case 'flutterwave':
        return new FlutterwavePaymentProvider({
          secretKey: config.FLUTTERWAVE_SECRET_KEY ?? '',
          webhookHash: config.FLUTTERWAVE_WEBHOOK_HASH ?? '',
          baseUrl: config.FLUTTERWAVE_API_URL,
          timeoutMs,
        });
      case 'stripe':
        return new StripePaymentProvider({
          secretKey: config.STRIPE_SECRET_KEY ?? '',
          webhookSecret: config.STRIPE_WEBHOOK_SECRET ?? '',
          baseUrl: config.STRIPE_API_URL,
          timeoutMs,
        });
    }
  });
}

@Module({
  providers: [
    MockPaymentProvider,
    {
      provide: PAYMENT_PROVIDER_LIST,
      inject: [APP_CONFIG, MockPaymentProvider],
      useFactory: providerList,
    },
    PaymentProviders,
  ],
  exports: [PaymentProviders, MockPaymentProvider],
})
export class PaymentsModule {}
