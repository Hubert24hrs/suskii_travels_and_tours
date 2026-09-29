/**
 * Payment methods each provider adds at checkout (PROJECT_SPEC.json#/tech_stack integrations).
 * The homepage trust strip shows only methods the platform actually supports, so the list comes
 * from providers with a working adapter. Payment adapters arrive in phase 6.
 */
const PROVIDER_METHODS = {
  paystack: ['visa', 'mastercard', 'verve', 'bank_transfer', 'ussd'],
  flutterwave: ['visa', 'mastercard', 'verve', 'bank_transfer', 'ussd'],
  stripe: ['visa', 'mastercard'],
} as const;

export type PaymentProviderKey = keyof typeof PROVIDER_METHODS;
type PaymentMethodKey = (typeof PROVIDER_METHODS)[PaymentProviderKey][number];

const METHOD_LABELS: Record<PaymentMethodKey, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  verve: 'Verve',
  bank_transfer: 'Bank transfer',
  ussd: 'USSD',
};

const PROVIDER_LABELS: Record<PaymentProviderKey, string> = {
  paystack: 'Paystack',
  flutterwave: 'Flutterwave',
  stripe: 'Stripe',
};

/** Distinct methods (and the providers themselves) for the given enabled providers. */
export function paymentMethodsFor(
  providers: readonly PaymentProviderKey[],
): { key: string; label: string }[] {
  const keys = new Set<PaymentMethodKey>(
    providers.flatMap((provider) => PROVIDER_METHODS[provider]),
  );
  return [
    ...providers.map((provider) => ({ key: provider, label: PROVIDER_LABELS[provider] })),
    ...[...keys].map((key) => ({ key, label: METHOD_LABELS[key] })),
  ];
}

/** Providers with a working adapter. None until phase 6, so the trust strip shows no logos yet. */
export const IMPLEMENTED_PAYMENT_PROVIDERS: readonly PaymentProviderKey[] = [];
