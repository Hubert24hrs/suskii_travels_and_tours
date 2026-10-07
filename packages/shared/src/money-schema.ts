import { z } from './zod-setup';

import { CURRENCY_PATTERN } from './money';

/** Validates the MoneyWire JSON shape (money.ts); kept apart so money.ts stays Zod-free. */
export const moneyWireSchema = z.object({
  amountMinor: z
    .number()
    .int()
    .refine(Number.isSafeInteger, 'Amount exceeds the safe integer range'),
  currency: z.string().regex(CURRENCY_PATTERN),
});
