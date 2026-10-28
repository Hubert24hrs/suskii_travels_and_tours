import { fromWire, toDecimalString, type MoneyWire } from '@suskii/shared/lite';

import type { AdEventParams } from './ad-events';

/**
 * An API Money value as the networks read it: a decimal amount and its currency. Apart from
 * `ad-events`, which every page loads, so only checkout and booking pages ship the money code.
 */
export const adValue = (amount: MoneyWire): Pick<AdEventParams, 'value' | 'currency'> => ({
  value: toDecimalString(fromWire(amount)),
  currency: amount.currency,
});
