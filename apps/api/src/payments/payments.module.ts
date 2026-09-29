import { Module } from '@nestjs/common';

import { MockPaymentProvider } from './mock-payment-provider';
import { PaymentProvider } from './payment-provider';

@Module({
  providers: [
    MockPaymentProvider,
    // PAYMENT_PROVIDER only allows `mock` until phase 6 adds real adapters.
    { provide: PaymentProvider, useExisting: MockPaymentProvider },
  ],
  exports: [PaymentProvider, MockPaymentProvider],
})
export class PaymentsModule {}
