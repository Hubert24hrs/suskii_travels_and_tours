import { z } from './zod-setup';

import { SUPPORTED_CURRENCIES } from './currency-codes';

export {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  type CurrencyCode,
} from './currency-codes';

export const currencyCodeSchema = z.enum(SUPPORTED_CURRENCIES);
