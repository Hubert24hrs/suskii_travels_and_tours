import { z } from 'zod';

/**
 * Exact money arithmetic. Amounts are integer minor units held as `bigint` (kobo for NGN, cents
 * for USD) with an ISO 4217 currency code. Floats never touch an amount: every operation that can
 * produce a fraction takes an explicit rounding mode.
 */
export interface Money {
  readonly minor: bigint;
  readonly currency: string;
}

/**
 * - `half-even`: ties to the even neighbour (banker's rounding); the default for conversions.
 * - `half-up`: ties away from zero (what people expect on receipts).
 * - `ceil` / `floor`: towards positive / negative infinity.
 */
export type RoundingMode = 'half-even' | 'half-up' | 'ceil' | 'floor';

export const ROUNDING_MODES: readonly RoundingMode[] = ['half-even', 'half-up', 'ceil', 'floor'];

/** ISO 4217 minor-unit exponents that differ from the usual 2. */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

export function assertCurrency(currency: string): void {
  if (!CURRENCY_PATTERN.test(currency)) throw new RangeError(`Invalid currency code: ${currency}`);
}

/** Number of minor-unit digits for a currency (NGN 2, JPY 0, KWD 3). */
export function currencyExponent(currency: string): number {
  assertCurrency(currency);
  return EXPONENT_OVERRIDES[currency] ?? 2;
}

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

/** Integer division with an explicit rounding mode. */
export function roundDiv(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const quotient = n / d; // truncates towards zero
  const remainder = n % d; // same sign as n
  if (remainder === 0n) return quotient;
  const negative = n < 0n;
  const awayFromZero = negative ? quotient - 1n : quotient + 1n;
  switch (mode) {
    case 'floor':
      return negative ? quotient - 1n : quotient;
    case 'ceil':
      return negative ? quotient : quotient + 1n;
    case 'half-up':
    case 'half-even': {
      const twice = 2n * (remainder < 0n ? -remainder : remainder);
      if (twice > d) return awayFromZero;
      if (twice < d) return quotient;
      if (mode === 'half-up') return awayFromZero;
      return quotient % 2n === 0n ? quotient : awayFromZero;
    }
  }
}

function toBigInt(value: bigint | number): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new RangeError(`Not a safe integer: ${value}`);
  return BigInt(value);
}

export function money(minor: bigint | number, currency: string): Money {
  assertCurrency(currency);
  return { minor: toBigInt(minor), currency };
}

export function zero(currency: string): Money {
  return money(0n, currency);
}

/**
 * Parses a decimal string ("12500.5") into minor units. Extra fraction digits are an error unless
 * a rounding mode is given (supplier amounts sometimes carry more precision than the currency).
 */
export function parseMoney(decimal: string, currency: string, rounding?: RoundingMode): Money {
  const exponent = currencyExponent(currency);
  const match = DECIMAL_PATTERN.exec(decimal.trim());
  if (!match) throw new RangeError(`Invalid decimal amount: ${decimal}`);
  const [, sign, whole = '0', fraction = ''] = match;
  let minor: bigint;
  if (fraction.length <= exponent) {
    minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  } else {
    if (!rounding) {
      throw new RangeError(`${decimal} has more than ${exponent} decimal places for ${currency}`);
    }
    const scaled = BigInt(whole + fraction);
    minor = roundDiv(sign ? -scaled : scaled, pow10(fraction.length - exponent), rounding);
    return money(minor, currency);
  }
  return money(sign ? -minor : minor, currency);
}

/** "-1250.50" style decimal string with exactly the currency's number of decimals. */
export function toDecimalString(amount: Money): string {
  const exponent = currencyExponent(amount.currency);
  const negative = amount.minor < 0n;
  const digits = (negative ? -amount.minor : amount.minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new RangeError(`Currency mismatch: ${a.currency} and ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function sum(currency: string, amounts: readonly Money[]): Money {
  return amounts.reduce((total, amount) => add(total, amount), zero(currency));
}

export function negate(amount: Money): Money {
  return { minor: -amount.minor, currency: amount.currency };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

export function isZero(amount: Money): boolean {
  return amount.minor === 0n;
}

export function isNegative(amount: Money): boolean {
  return amount.minor < 0n;
}

export function minOf(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function maxOf(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

/** Multiplies by a whole number (e.g. per-passenger fee x passengers). */
export function multiply(amount: Money, factor: bigint | number): Money {
  return { minor: amount.minor * toBigInt(factor), currency: amount.currency };
}

/** amount x numerator / denominator, rounded. */
export function multiplyRatio(
  amount: Money,
  numerator: bigint | number,
  denominator: bigint | number,
  rounding: RoundingMode,
): Money {
  return {
    minor: roundDiv(amount.minor * toBigInt(numerator), toBigInt(denominator), rounding),
    currency: amount.currency,
  };
}

/** Basis points: 1 bp = 0.01%, 250 = 2.5%, 10000 = 100%. */
export function percentageOf(
  amount: Money,
  basisPoints: bigint | number,
  rounding: RoundingMode,
): Money {
  return multiplyRatio(amount, basisPoints, 10_000n, rounding);
}

/**
 * Splits an amount by weights so the parts always add up exactly (largest-remainder method):
 * each part is within one minor unit of its exact share. Used for per-passenger and instalment
 * splits.
 */
export function allocate(amount: Money, weights: readonly (bigint | number)[]): Money[] {
  const ratios = weights.map(toBigInt);
  if (ratios.length === 0) throw new RangeError('allocate needs at least one weight');
  if (ratios.some((ratio) => ratio < 0n)) throw new RangeError('Weights must not be negative');
  const totalWeight = ratios.reduce((acc, ratio) => acc + ratio, 0n);
  if (totalWeight === 0n) throw new RangeError('Weights must not all be zero');

  const negative = amount.minor < 0n;
  const total = negative ? -amount.minor : amount.minor;
  const shares = ratios.map((ratio) => (total * ratio) / totalWeight);
  let leftover = total - shares.reduce((acc, share) => acc + share, 0n);
  // Hand the leftover units to the largest fractional remainders (ties: earliest index).
  const order = ratios
    .map((ratio, index) => ({ index, remainder: (total * ratio) % totalWeight }))
    .filter(({ index }) => (ratios[index] ?? 0n) > 0n)
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { index } of order) {
    if (leftover === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return shares.map((share) => ({ minor: negative ? -share : share, currency: amount.currency }));
}

// ---------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------

/** An exact exchange rate: 1 unit of `from` = numerator / denominator units of `to`. */
export interface ExchangeRate {
  readonly from: string;
  readonly to: string;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Builds an exact rate from a decimal string such as "1545.2371". */
export function parseRate(from: string, to: string, decimal: string): ExchangeRate {
  assertCurrency(from);
  assertCurrency(to);
  const match = DECIMAL_PATTERN.exec(decimal.trim());
  if (!match || match[1]) throw new RangeError(`Invalid exchange rate: ${decimal}`);
  const [, , whole = '0', fraction = ''] = match;
  const numerator = BigInt(whole + fraction);
  if (numerator === 0n) throw new RangeError('Exchange rate must be positive');
  return { from, to, numerator, denominator: pow10(fraction.length) };
}

export function identityRate(currency: string): ExchangeRate {
  assertCurrency(currency);
  return { from: currency, to: currency, numerator: 1n, denominator: 1n };
}

export function invertRate(rate: ExchangeRate): ExchangeRate {
  return { from: rate.to, to: rate.from, numerator: rate.denominator, denominator: rate.numerator };
}

/** Cross rate through a common base: (base->from, base->to) gives from->to. */
export function crossRate(baseToFrom: ExchangeRate, baseToTo: ExchangeRate): ExchangeRate {
  if (baseToFrom.from !== baseToTo.from) throw new RangeError('Cross rates need a common base');
  return {
    from: baseToFrom.to,
    to: baseToTo.to,
    numerator: baseToTo.numerator * baseToFrom.denominator,
    denominator: baseToTo.denominator * baseToFrom.numerator,
  };
}

/** Converts exactly, rounding once at the end, across currencies with different exponents. */
export function convert(
  amount: Money,
  rate: ExchangeRate,
  rounding: RoundingMode = 'half-even',
): Money {
  if (amount.currency !== rate.from) {
    throw new RangeError(`Rate is for ${rate.from}, amount is ${amount.currency}`);
  }
  const numerator = amount.minor * rate.numerator * pow10(currencyExponent(rate.to));
  const denominator = rate.denominator * pow10(currencyExponent(rate.from));
  return { minor: roundDiv(numerator, denominator, rounding), currency: rate.to };
}

/** Decimal representation of a rate with up to `scale` fraction digits (display and audit). */
export function formatRate(rate: ExchangeRate, scale = 8): string {
  const scaled = roundDiv(rate.numerator * pow10(scale), rate.denominator, 'half-even');
  const digits = scaled.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

// ---------------------------------------------------------------------------
// Presentation and wire format
// ---------------------------------------------------------------------------

/** Locale-aware formatting ("₦12,500.00"). The decimal string is passed to Intl as-is (exact). */
export function formatMoney(
  amount: Money,
  locale: string,
  options: { hideZeroDecimals?: boolean } = {},
): string {
  const exponent = currencyExponent(amount.currency);
  const wholeUnits = amount.minor % pow10(exponent) === 0n;
  const decimals = options.hideZeroDecimals && wholeUnits ? 0 : exponent;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: amount.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toDecimalString(amount) as Intl.StringNumericLiteral);
}

/** JSON shape used by the API: integer minor units (always a safe integer) and the currency. */
export interface MoneyWire {
  amountMinor: number;
  currency: string;
}

export const moneyWireSchema = z.object({
  amountMinor: z
    .number()
    .int()
    .refine(Number.isSafeInteger, 'Amount exceeds the safe integer range'),
  currency: z.string().regex(CURRENCY_PATTERN),
});

export function toWire(amount: Money): MoneyWire {
  const value = Number(amount.minor);
  if (!Number.isSafeInteger(value)) throw new RangeError('Amount exceeds the safe integer range');
  return { amountMinor: value, currency: amount.currency };
}

export function fromWire(wire: MoneyWire): Money {
  return money(wire.amountMinor, wire.currency);
}
