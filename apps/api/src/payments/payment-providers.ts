import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { PaymentMethod, PaymentProvider } from './payment-provider';

export const PAYMENT_PROVIDER_LIST = Symbol('PAYMENT_PROVIDER_LIST');
/** Names of enabled providers that take no new payments (`PAYMENT_PROVIDERS_PAUSED`). */
export const PAUSED_PAYMENT_PROVIDERS = Symbol('PAUSED_PAYMENT_PROVIDERS');

export interface ProviderOption {
  name: PaymentProvider['name'];
  methods: PaymentMethod[];
}

/**
 * The enabled payment providers in preference order (ADR-016): routing by currency, lookup by
 * name for webhooks and refunds. A paused provider takes no new payments but still owns the ones
 * it has (webhooks, reconciliation, refunds).
 */
@Injectable()
export class PaymentProviders {
  constructor(
    @Inject(PAYMENT_PROVIDER_LIST) private readonly providers: PaymentProvider[],
    @Inject(PAUSED_PAYMENT_PROVIDERS) private readonly paused: readonly string[] = [],
  ) {}

  all(): readonly PaymentProvider[] {
    return this.providers;
  }

  /** Providers that take new payments in `currency`, in configured order. */
  forCurrency(currency: string): PaymentProvider[] {
    return this.providers.filter(
      (provider) => provider.currencies.includes(currency) && !this.paused.includes(provider.name),
    );
  }

  options(currency: string): ProviderOption[] {
    return this.forCurrency(currency).map(({ name, methods }) => ({ name, methods: [...methods] }));
  }

  /** The provider to charge with: the requested one if it settles the currency, else the first. */
  choose(currency: string, requested?: string | null): PaymentProvider | null {
    const candidates = this.forCurrency(currency);
    if (requested) return candidates.find((provider) => provider.name === requested) ?? null;
    return candidates[0] ?? null;
  }

  /** A provider that may no longer be enabled still owns its payments (refunds, webhooks). */
  find(name: string): PaymentProvider | undefined {
    return this.providers.find((provider) => provider.name === name);
  }

  get(name: string): PaymentProvider {
    const provider = this.find(name);
    if (!provider) throw new NotFoundException();
    return provider;
  }
}
