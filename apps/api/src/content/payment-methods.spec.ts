import { enabledPaymentProviders, paymentMethodsFor } from './payment-methods';

describe('payment methods', () => {
  it('lists nothing while only the mock provider is enabled', () => {
    expect(enabledPaymentProviders(['mock'])).toEqual([]);
    expect(paymentMethodsFor(enabledPaymentProviders(['mock']))).toEqual([]);
  });

  it('keeps the configured order of real providers', () => {
    expect(enabledPaymentProviders(['stripe', 'mock', 'paystack'])).toEqual(['stripe', 'paystack']);
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
