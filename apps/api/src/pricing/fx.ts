/** Exchange rates against one base currency, as decimal strings (exact). */
export interface FxSnapshot {
  base: string;
  rates: Readonly<Record<string, string>>;
  /** When the provider published these rates (ISO 8601). */
  asOf: string;
  provider: string;
}

/**
 * Exchange-rate source (PROJECT_SPEC.json#/tech_stack/integrations/fx). Which rate to use for
 * the naira (official or market) is a business decision; see ADR-008.
 */
export abstract class FxProvider {
  abstract readonly name: string;
  abstract latest(signal?: AbortSignal): Promise<FxSnapshot>;
}

/**
 * MOCK exchange rates for development and tests only. The values are illustrative, not market
 * data; production refuses to start with this provider unless ALLOW_MOCK_PROVIDERS=true.
 */
export const MOCK_FX_RATES: Readonly<Record<string, string>> = {
  USD: '1',
  NGN: '1550',
  GBP: '0.79',
  EUR: '0.92',
  GHS: '15.4',
  KES: '129.5',
  ZAR: '18.25',
  AED: '3.6725',
  XOF: '603.5',
  JPY: '149.5',
};

export class MockFxProvider extends FxProvider {
  readonly name = 'mock';

  latest(): Promise<FxSnapshot> {
    return Promise.resolve({
      base: 'USD',
      rates: MOCK_FX_RATES,
      asOf: new Date().toISOString(),
      provider: this.name,
    });
  }
}
