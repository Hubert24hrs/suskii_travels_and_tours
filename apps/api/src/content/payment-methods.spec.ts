import { IMPLEMENTED_PAYMENT_PROVIDERS, paymentMethodsFor } from './payment-methods';

describe('payment methods', () => {
  it('lists nothing until a payment adapter exists (phase 6)', () => {
    expect(IMPLEMENTED_PAYMENT_PROVIDERS).toEqual([]);
    expect(paymentMethodsFor(IMPLEMENTED_PAYMENT_PROVIDERS)).toEqual([]);
  });

  it('lists enabled providers and their distinct methods', () => {
    expect(paymentMethodsFor(['paystack', 'stripe']).map((method) => method.key)).toEqual([
      'paystack',
      'stripe',
      'visa',
      'mastercard',
      'verve',
      'bank_transfer',
      'ussd',
    ]);
  });
});
