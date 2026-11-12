import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  add,
  allocate,
  compare,
  convert,
  crossRate,
  currencyExponent,
  formatMoney,
  formatRate,
  fromWire,
  identityRate,
  invertRate,
  money,
  multiply,
  multiplyRatio,
  parseMoney,
  parseRate,
  percentageOf,
  ROUNDING_MODES,
  roundDiv,
  subtract,
  sum,
  toDecimalString,
  toWire,
  zero,
  type Money,
  type RoundingMode,
} from './money';

const RUNS = { numRuns: 500 };
const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'JPY', 'KWD'] as const;

const minorArb = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const currencyArb = fc.constantFrom(...CURRENCIES);
const moneyArb = fc.tuple(minorArb, currencyArb).map(([minor, currency]) => money(minor, currency));
const sameCurrencyPair = currencyArb.chain((currency) =>
  fc.tuple(minorArb, minorArb).map(([a, b]) => [money(a, currency), money(b, currency)] as const),
);
const modeArb = fc.constantFrom<RoundingMode>(...ROUNDING_MODES);
const abs = (value: bigint): bigint => (value < 0n ? -value : value);

describe('roundDiv (reference properties)', () => {
  const inputs = fc.tuple(
    fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
    fc.bigInt({ min: 1n, max: 10n ** 12n }),
    fc.boolean(),
  );

  it('floor and ceil bracket the exact quotient', () => {
    fc.assert(
      fc.property(inputs, ([n, d, flip]) => {
        const [num, den] = flip ? [-n, -d] : [n, d];
        const floor = roundDiv(num, den, 'floor');
        const ceil = roundDiv(num, den, 'ceil');
        // floor <= num/den <= ceil, and they differ by at most 1.
        expect(floor * d <= (flip ? -num : num)).toBe(true);
        expect(ceil * d >= (flip ? -num : num)).toBe(true);
        expect(ceil - floor <= 1n).toBe(true);
      }),
      RUNS,
    );
  });

  it('half modes return the nearest integer and break ties as specified', () => {
    fc.assert(
      fc.property(inputs, ([n, d]) => {
        for (const mode of ['half-up', 'half-even'] as const) {
          const q = roundDiv(n, d, mode);
          const error = abs(n - q * d) * 2n;
          expect(error <= d).toBe(true); // |n/d - q| <= 1/2
          if (error === d) {
            // Exact tie.
            if (mode === 'half-even') expect(q % 2n).toBe(0n);
            else expect(abs(q) * d > abs(n)).toBe(true); // away from zero
          }
        }
      }),
      RUNS,
    );
  });

  it('is exact when the division is exact, whatever the mode', () => {
    fc.assert(
      fc.property(minorArb, fc.bigInt({ min: 1n, max: 10n ** 9n }), modeArb, (q, d, mode) => {
        expect(roundDiv(q * d, d, mode)).toBe(q);
      }),
      RUNS,
    );
  });

  it('rejects division by zero', () => {
    expect(() => roundDiv(1n, 0n, 'half-even')).toThrow(RangeError);
  });
});

describe('addition and subtraction', () => {
  it('are commutative, associative, have an identity and invert each other', () => {
    fc.assert(
      fc.property(
        currencyArb.chain((c) =>
          fc.tuple(minorArb, minorArb, minorArb).map((t) => t.map((m) => money(m, c))),
        ),
        ([a, b, c]) => {
          if (!a || !b || !c) return;
          expect(add(a, b)).toEqual(add(b, a));
          expect(add(add(a, b), c)).toEqual(add(a, add(b, c)));
          expect(add(a, zero(a.currency))).toEqual(a);
          expect(subtract(add(a, b), b)).toEqual(a);
          expect(sum(a.currency, [a, b, c])).toEqual(add(add(a, b), c));
        },
      ),
      RUNS,
    );
  });

  it('never mixes currencies', () => {
    expect(() => add(money(1n, 'NGN'), money(1n, 'USD'))).toThrow(/Currency mismatch/);
  });

  it('orders amounts consistently', () => {
    fc.assert(
      fc.property(sameCurrencyPair, ([a, b]) => {
        expect(compare(a, b) + compare(b, a)).toBe(0);
        expect(compare(a, b) === 0).toBe(a.minor === b.minor);
      }),
      RUNS,
    );
  });
});

describe('ratios, percentages and multiplication', () => {
  it('keeps a percentage between zero and the amount for 0-100%', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.integer({ min: 0, max: 10_000 }),
        modeArb,
        (minor, bps, mode) => {
          const amount = money(minor, 'NGN');
          const part = percentageOf(amount, bps, mode);
          expect(part.minor >= 0n && part.minor <= minor).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it('matches exact rational arithmetic within half a minor unit', () => {
    fc.assert(
      fc.property(
        moneyArb,
        fc.bigInt({ min: 0n, max: 10n ** 6n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (m, num, den) => {
          const result = multiplyRatio(m, num, den, 'half-even');
          expect(abs(result.minor * den - m.minor * num) * 2n <= den).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it('multiplies by whole numbers exactly', () => {
    fc.assert(
      fc.property(moneyArb, fc.integer({ min: 0, max: 9 }), (m, factor) => {
        const expected = Array.from({ length: factor }, () => m).reduce(add, zero(m.currency));
        expect(multiply(m, factor)).toEqual(expected);
      }),
      RUNS,
    );
  });
});

describe('allocate', () => {
  const weightsArb = fc
    .array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 12 })
    .filter((weights) => weights.some((weight) => weight > 0));

  it('always sums to the original amount, even for negative amounts', () => {
    fc.assert(
      fc.property(moneyArb, weightsArb, (m, weights) => {
        const parts = allocate(m, weights);
        expect(parts).toHaveLength(weights.length);
        expect(sum(m.currency, parts)).toEqual(m);
      }),
      RUNS,
    );
  });

  it('gives each part its exact share to within one minor unit, and zero weights nothing', () => {
    fc.assert(
      fc.property(moneyArb, weightsArb, (m, weights) => {
        const total = BigInt(weights.reduce((a, b) => a + b, 0));
        allocate(m, weights).forEach((part, index) => {
          const weight = BigInt(weights[index] ?? 0);
          if (weight === 0n) expect(part.minor).toBe(0n);
          // |part - m*w/W| < 1  <=>  |part*W - m*w| < W
          expect(abs(part.minor * total - m.minor * weight) < total).toBe(true);
        });
      }),
      RUNS,
    );
  });

  it('splits evenly when it can and is deterministic', () => {
    expect(allocate(money(1000n, 'NGN'), [1, 1, 1]).map((p) => p.minor)).toEqual([
      334n,
      333n,
      333n,
    ]);
    expect(allocate(money(-1000n, 'NGN'), [1, 1, 1]).map((p) => p.minor)).toEqual([
      -334n,
      -333n,
      -333n,
    ]);
    expect(allocate(money(100n, 'USD'), [0, 1]).map((p) => p.minor)).toEqual([0n, 100n]);
    expect(() => allocate(money(1n, 'USD'), [])).toThrow();
    expect(() => allocate(money(1n, 'USD'), [0, 0])).toThrow();
    expect(() => allocate(money(1n, 'USD'), [-1, 2])).toThrow();
  });
});

describe('decimal parsing and formatting', () => {
  it('round-trips every amount through its decimal string', () => {
    fc.assert(
      fc.property(moneyArb, (m) => {
        expect(parseMoney(toDecimalString(m), m.currency)).toEqual(m);
      }),
      RUNS,
    );
  });

  it('uses ISO 4217 exponents', () => {
    expect(currencyExponent('NGN')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(toDecimalString(money(-5n, 'USD'))).toBe('-0.05');
    expect(toDecimalString(money(1234n, 'JPY'))).toBe('1234');
    expect(toDecimalString(money(1234n, 'KWD'))).toBe('1.234');
    expect(() => currencyExponent('naira')).toThrow();
  });

  it('refuses extra precision unless asked to round', () => {
    expect(parseMoney('12500', 'NGN').minor).toBe(1_250_000n);
    expect(parseMoney('0.5', 'USD').minor).toBe(50n);
    expect(() => parseMoney('10.005', 'USD')).toThrow(/decimal places/);
    expect(parseMoney('10.005', 'USD', 'half-even').minor).toBe(1000n);
    expect(parseMoney('10.015', 'USD', 'half-even').minor).toBe(1002n);
    expect(parseMoney('-10.005', 'USD', 'half-up').minor).toBe(-1001n);
    expect(() => parseMoney('1e3', 'USD')).toThrow(/Invalid decimal/);
    expect(() => parseMoney('12,50', 'USD')).toThrow(/Invalid decimal/);
  });

  it('formats with the locale and exact decimals', () => {
    expect(formatMoney(money(1_250_000n, 'NGN'), 'en-NG')).toBe('₦12,500.00');
    expect(formatMoney(money(1_250_000n, 'NGN'), 'en-NG', { hideZeroDecimals: true })).toBe(
      '₦12,500',
    );
    expect(formatMoney(money(999n, 'USD'), 'en-US')).toBe('$9.99');
    // Larger than Number.MAX_SAFE_INTEGER minor units still formats exactly.
    expect(formatMoney(money(12_345_678_901_234_567_89n, 'USD'), 'en-US')).toBe(
      '$12,345,678,901,234,567.89',
    );
  });
});

describe('exchange rates and conversion', () => {
  const rateArb = fc
    .tuple(fc.bigInt({ min: 1n, max: 10n ** 9n }), fc.integer({ min: 0, max: 8 }))
    .map(([digits, scale]) => {
      const text = digits.toString().padStart(scale + 1, '0');
      return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
    });

  it('parses and formats decimal rates exactly', () => {
    const rate = parseRate('USD', 'NGN', '1545.2371');
    expect(rate).toEqual({ from: 'USD', to: 'NGN', numerator: 15_452_371n, denominator: 10_000n });
    expect(formatRate(rate)).toBe('1545.2371');
    expect(formatRate(invertRate(parseRate('USD', 'NGN', '1600')))).toBe('0.000625');
    expect(() => parseRate('USD', 'NGN', '0')).toThrow();
    expect(() => parseRate('USD', 'NGN', '-1')).toThrow();
  });

  it('rounds conversions to the nearest representable amount, across exponents', () => {
    fc.assert(
      fc.property(moneyArb, currencyArb, rateArb, (m, target, decimal) => {
        const rate = parseRate(m.currency, target, decimal);
        const converted = convert(m, rate);
        expect(converted.currency).toBe(target);
        const scaleTo = 10n ** BigInt(currencyExponent(target));
        const scaleFrom = 10n ** BigInt(currencyExponent(m.currency));
        const exactNumerator = m.minor * rate.numerator * scaleTo;
        const exactDenominator = rate.denominator * scaleFrom;
        expect(
          abs(converted.minor * exactDenominator - exactNumerator) * 2n <= exactDenominator,
        ).toBe(true);
      }),
      RUNS,
    );
  });

  it('is monotonic and the identity rate changes nothing', () => {
    fc.assert(
      fc.property(sameCurrencyPair, rateArb, ([a, b], decimal) => {
        const rate = parseRate(a.currency, 'NGN', decimal);
        const [low, high] = compare(a, b) <= 0 ? [a, b] : [b, a];
        expect(convert(low, rate).minor <= convert(high, rate).minor).toBe(true);
        expect(convert(a, identityRate(a.currency))).toEqual(a);
      }),
      RUNS,
    );
  });

  it('builds exact cross rates through a base currency', () => {
    const usdToNgn = parseRate('USD', 'NGN', '1600');
    const usdToGbp = parseRate('USD', 'GBP', '0.8');
    const ngnToGbp = crossRate(usdToNgn, usdToGbp);
    expect(ngnToGbp.from).toBe('NGN');
    expect(ngnToGbp.to).toBe('GBP');
    // 160,000.00 NGN = 100 USD = 80.00 GBP exactly.
    expect(convert(money(16_000_000n, 'NGN'), ngnToGbp)).toEqual(money(8000n, 'GBP'));
    expect(() => crossRate(usdToNgn, invertRate(usdToGbp))).toThrow(/common base/);
    expect(() => convert(money(1n, 'EUR'), usdToNgn)).toThrow(/Rate is for USD/);
  });

  it('converts to and from a lower-precision currency', () => {
    const usdToJpy = parseRate('USD', 'JPY', '149.5');
    expect(convert(money(1000n, 'USD'), usdToJpy)).toEqual(money(1495n, 'JPY'));
    expect(convert(money(1n, 'USD'), usdToJpy, 'ceil')).toEqual(money(2n, 'JPY'));
  });
});

describe('wire format', () => {
  it('round-trips safe amounts and rejects unsafe ones', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        currencyArb,
        (minor, currency) => {
          const m: Money = money(minor, currency);
          expect(fromWire(toWire(m))).toEqual(m);
        },
      ),
      RUNS,
    );
    expect(() => toWire(money(2n ** 60n, 'USD'))).toThrow(/safe integer/);
    expect(() => money(0.5, 'USD')).toThrow(/safe integer/);
  });
});
