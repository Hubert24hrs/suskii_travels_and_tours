import type { PaymentMethod, PaymentProvider } from './payment-provider';
import { PaymentProviders } from './payment-providers';

const provider = (
  name: PaymentProvider['name'],
  currencies: string[],
  methods: Record<string, PaymentMethod[]> = {},
): PaymentProvider =>
  ({
    name,
    currencies,
    methodsFor: (currency: string) =>
      currencies.includes(currency) ? (methods[currency] ?? ['card']) : [],
  }) as unknown as PaymentProvider;

describe('PaymentProviders', () => {
  const paystack = provider('paystack', ['NGN']);
  const flutterwave = provider('flutterwave', ['NGN', 'USD']);
  const stripe = provider('stripe', ['USD']);

  it('routes by currency in configured order', () => {
    const providers = new PaymentProviders([paystack, flutterwave, stripe]);
    expect(providers.choose('NGN')?.name).toBe('paystack');
    expect(providers.choose('USD')?.name).toBe('flutterwave');
    expect(providers.choose('NGN', 'stripe')).toBeNull();
  });

  it('takes no new payments through a paused provider but keeps it for existing ones', () => {
    const providers = new PaymentProviders([paystack, flutterwave, stripe], ['paystack']);
    expect(providers.choose('NGN')?.name).toBe('flutterwave');
    expect(providers.choose('NGN', 'paystack')).toBeNull();
    expect(providers.options('NGN').providers.map((option) => option.name)).toEqual([
      'flutterwave',
    ]);
    // Webhooks, reconciliation and refunds of its payments still find it.
    expect(providers.find('paystack')).toBe(paystack);
    expect(providers.all()).toHaveLength(3);
  });

  describe('methods (ADR-074)', () => {
    const paystackNgn = provider('paystack', ['NGN', 'GHS'], {
      NGN: ['card', 'bank_transfer', 'ussd', 'agent'],
      GHS: ['card', 'mobile_money'],
    });
    const stripeAll = provider('stripe', ['NGN', 'GHS', 'USD'], {
      NGN: ['card', 'apple_google_pay'],
      GHS: ['card', 'apple_google_pay'],
      USD: ['card', 'apple_google_pay'],
    });
    const providers = new PaymentProviders([paystackNgn, stripeAll]);

    it('lists each method once, in catalogue order, with the providers that take it', () => {
      expect(providers.options('NGN').methods).toEqual([
        { method: 'card', providers: ['paystack', 'stripe'] },
        { method: 'bank_transfer', providers: ['paystack'] },
        { method: 'ussd', providers: ['paystack'] },
        { method: 'apple_google_pay', providers: ['stripe'] },
        { method: 'agent', providers: ['paystack'] },
      ]);
      expect(providers.options('GHS').methods.map((option) => option.method)).toEqual([
        'card',
        'mobile_money',
        'apple_google_pay',
      ]);
    });

    it('routes a method to the first provider that takes it in the currency', () => {
      expect(providers.choose('NGN', null, 'card')?.name).toBe('paystack');
      expect(providers.choose('NGN', null, 'apple_google_pay')?.name).toBe('stripe');
      expect(providers.choose('GHS', null, 'mobile_money')?.name).toBe('paystack');
      expect(providers.choose('USD', null, 'mobile_money')).toBeNull();
      // A named provider must offer the method too.
      expect(providers.choose('NGN', 'stripe', 'ussd')).toBeNull();
      expect(providers.choose('NGN', 'stripe', 'card')?.name).toBe('stripe');
    });
  });
});
