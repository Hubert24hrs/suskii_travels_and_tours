import type { PaymentProvider } from './payment-provider';
import { PaymentProviders } from './payment-providers';

const provider = (name: PaymentProvider['name'], currencies: string[]): PaymentProvider =>
  ({ name, currencies, methods: ['card'] }) as unknown as PaymentProvider;

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
    expect(providers.options('NGN').map((option) => option.name)).toEqual(['flutterwave']);
    // Webhooks, reconciliation and refunds of its payments still find it.
    expect(providers.find('paystack')).toBe(paystack);
    expect(providers.all()).toHaveLength(3);
  });
});
