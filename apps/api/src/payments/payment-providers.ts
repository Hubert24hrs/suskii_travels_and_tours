import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PAYMENT_METHOD_LIST, type PaymentMethod, type PaymentProvider } from './payment-provider';

export const PAYMENT_PROVIDER_LIST = Symbol('PAYMENT_PROVIDER_LIST');
/** Names of enabled providers that take no new payments (`PAYMENT_PROVIDERS_PAUSED`). */
export const PAUSED_PAYMENT_PROVIDERS = Symbol('PAUSED_PAYMENT_PROVIDERS');

export interface ProviderOption {
  name: PaymentProvider['name'];
  methods: PaymentMethod[];
}

/** A method checkout can offer, with the providers that take it (ADR-074). */
export interface MethodOption {
  method: PaymentMethod;
  providers: PaymentProvider['name'][];
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

  /** What checkout offers in `currency`: providers (older apps) and methods, in catalogue order. */
  options(currency: string): { providers: ProviderOption[]; methods: MethodOption[] } {
    const providers = this.forCurrency(currency).map((provider) => ({
      name: provider.name,
      methods: [...provider.methodsFor(currency)],
    }));
    const methods = PAYMENT_METHOD_LIST.map((method) => ({
      method,
      providers: providers
        .filter((provider) => provider.methods.includes(method))
        .map((provider) => provider.name),
    })).filter((option) => option.providers.length > 0);
    return { providers, methods };
  }

  /**
   * The provider to charge with: the requested one if it settles the currency (and offers the
   * method), else the first in configured order that offers the method (ADR-074).
   */
  choose(
    currency: string,
    requested?: string | null,
    method?: PaymentMethod | null,
  ): PaymentProvider | null {
    const candidates = this.forCurrency(currency).filter(
      (provider) => !method || provider.methodsFor(currency).includes(method),
    );
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
