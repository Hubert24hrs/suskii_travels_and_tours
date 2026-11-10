import { describe, expect, it } from 'vitest';

import { money } from './money';
import {
  FAILURE_REACTIONS,
  PROXY_CLASSES,
  SCRAPE_FAILURE_CLASSES,
  basisIssue,
  budgetAlertLevel,
  currencyInText,
  decimalFromText,
  firstProxyClass,
  hostInDomain,
  inNightWindow,
  judgeObservation,
  nextProxyClass,
  normaliseDomain,
  priceFromText,
  proxyAllowed,
} from './price-intel';

describe('source policies (ADR-102)', () => {
  it('accepts an assessment only where the site does not disallow automated access', () => {
    const ok = { robots: 'allowed', terms: 'silent' } as const;
    for (const basis of [
      'licence',
      'permission',
      'public_data_assessment',
      'counsel_note',
    ] as const) {
      expect(basisIssue({ basis, ...ok })).toBeNull();
    }
    for (const findings of [
      { robots: 'disallowed', terms: 'allowed' },
      { robots: 'allowed', terms: 'disallowed' },
      { robots: 'disallowed', terms: 'disallowed' },
    ] as const) {
      expect(basisIssue({ basis: 'public_data_assessment', ...findings })).toBe(
        'needs_licence_or_permission',
      );
      expect(basisIssue({ basis: 'counsel_note', ...findings })).toBe(
        'needs_licence_or_permission',
      );
      expect(basisIssue({ basis: 'licence', ...findings })).toBeNull();
      expect(basisIssue({ basis: 'permission', ...findings })).toBeNull();
    }
  });

  it('refuses any basis until the robots file and the terms have been read', () => {
    expect(basisIssue({ basis: 'licence', robots: 'unknown', terms: 'allowed' })).toBe(
      'findings_unknown',
    );
    expect(basisIssue({ basis: 'permission', robots: 'allowed', terms: 'unknown' })).toBe(
      'findings_unknown',
    );
  });

  it('stores a domain without scheme, port, path or www, and refuses what is not one', () => {
    expect(normaliseDomain('https://WWW.Example-Hotels.com:443/rooms?x=1')).toBe(
      'example-hotels.com',
    );
    expect(normaliseDomain('fares.example.co.uk.')).toBe('fares.example.co.uk');
    for (const bad of [
      '',
      'localhost',
      '10.0.0.1',
      'http://127.0.0.1/x',
      '[::1]',
      'not a host',
      'a..b.com',
      '-x.com',
    ]) {
      expect([bad, normaliseDomain(bad)]).toEqual([bad, null]);
    }
  });

  it('matches a host to its policy domain and never to a look-alike', () => {
    expect(hostInDomain('example.com', 'example.com')).toBe(true);
    expect(hostInDomain('Rooms.Example.com.', 'example.com')).toBe(true);
    expect(hostInDomain('example.com.evil.net', 'example.com')).toBe(false);
    expect(hostInDomain('notexample.com', 'example.com')).toBe(false);
    expect(hostInDomain('example.org', 'example.com')).toBe(false);
  });
});

describe('proxy ladder (ADR-102)', () => {
  const all = PROXY_CLASSES;

  it('never goes above the class the approver allowed', () => {
    for (const max of PROXY_CLASSES) {
      for (const current of PROXY_CLASSES) {
        const next = nextProxyClass(current, max, all);
        if (next !== null) expect(proxyAllowed(next, max)).toBe(true);
      }
    }
    expect(nextProxyClass('none', 'none', all)).toBeNull();
    expect(nextProxyClass('datacenter', 'datacenter', all)).toBeNull();
    expect(nextProxyClass('none', 'residential', all)).toBe('datacenter');
    expect(nextProxyClass('datacenter', 'residential', all)).toBe('residential');
    expect(nextProxyClass('residential', 'residential', all)).toBeNull();
    expect(nextProxyClass('unblocker', 'unblocker', all)).toBeNull();
  });

  it('skips classes a vendor does not offer, still within the limit', () => {
    expect(nextProxyClass('none', 'unblocker', ['none', 'unblocker'])).toBe('unblocker');
    expect(nextProxyClass('none', 'residential', ['none', 'unblocker'])).toBeNull();
    expect(firstProxyClass('none', ['datacenter', 'residential'])).toBeNull();
    expect(firstProxyClass('residential', ['datacenter', 'residential'])).toBe('datacenter');
    expect(firstProxyClass('unblocker', ['unblocker'])).toBe('unblocker');
    expect(firstProxyClass('none', ['none'])).toBe('none');
  });

  it('has exactly one reaction for every failure class, and stops on a policy refusal', () => {
    expect(Object.keys(FAILURE_REACTIONS).sort()).toEqual([...SCRAPE_FAILURE_CLASSES].sort());
    expect(FAILURE_REACTIONS.policy_denied).toBe('stop');
    expect(FAILURE_REACTIONS.blocked).toBe('escalate_proxy');
    expect(FAILURE_REACTIONS.quota_exhausted).toBe('open_breaker');
  });
});

describe('printed prices (ADR-102)', () => {
  it('reads amounts with either grouping convention into exact decimals', () => {
    const cases: [string, string, string | null][] = [
      ['1,250,000.50', 'NGN', '1250000.50'],
      ['1.250.000,50', 'EUR', '1250000.50'],
      ['250,000', 'NGN', '250000'],
      ['250.000', 'NGN', '250000'],
      ['250 000', 'NGN', '250000'],
      ["1'250.5", 'CHF', '1250.5'],
      ['1 250 000,5', 'MAD', '1250000.5'],
      // A currency without minor units has no decimal part to read.
      ['1 250 000,5', 'XOF', null],
      ['1 250 000', 'XOF', '1250000'],
      ['12.5', 'USD', '12.5'],
      ['1,5', 'EUR', '1.5'],
      ['85', 'GBP', '85'],
      ['1,250', 'JPY', '1250'],
      // Not one clear amount.
      ['12.50', 'JPY', null],
      ['1,25,000', 'NGN', null],
      ['1.2.3', 'USD', null],
      ['250 000 for 2 nights', 'NGN', null],
      ['120 - 180', 'USD', null],
      ['was 300 now 250', 'USD', null],
      ['call us', 'NGN', null],
    ];
    for (const [text, currency, expected] of cases) {
      expect([text, decimalFromText(text, currency)]).toEqual([text, expected]);
    }
  });

  it('treats a no-break or narrow space as a thousands separator', () => {
    expect(decimalFromText('250\u00a0000', 'NGN')).toBe('250000');
    expect(decimalFromText('1\u202f250\u202f000,50', 'EUR')).toBe('1250000.50');
    expect(priceFromText('1\u00a0250,50\u00a0€', 'NGN')).toEqual(money(125_050n, 'EUR'));
  });

  it('never joins separate numbers into one amount', () => {
    expect(decimalFromText('250 000   2', 'NGN')).toBeNull();
    expect(decimalFromText('1 2500', 'NGN')).toBeNull();
    expect(decimalFromText('99 1234', 'NGN')).toBeNull();
  });

  it('names the currency a text prints, and none for a bare dollar sign', () => {
    expect(currencyInText('₦250,000')).toBe('NGN');
    expect(currencyInText('N250,000')).toBe('NGN');
    expect(currencyInText('NGN 250,000')).toBe('NGN');
    expect(currencyInText('GH₵ 1,200')).toBe('GHS');
    expect(currencyInText('KSh 12,500')).toBe('KES');
    expect(currencyInText('R 1 200')).toBe('ZAR');
    expect(currencyInText('£85')).toBe('GBP');
    expect(currencyInText('1.250,50 €')).toBe('EUR');
    expect(currencyInText('US$120')).toBe('USD');
    expect(currencyInText('AED 400')).toBe('AED');
    expect(currencyInText('$120')).toBeNull();
    expect(currencyInText('120')).toBeNull();
    expect(currencyInText('PER night 120')).toBeNull();
  });

  it('gives money in minor units, falling back to the market currency', () => {
    expect(priceFromText('₦1,250,000.50', 'NGN')).toEqual(money(125_000_050n, 'NGN'));
    expect(priceFromText('From NGN 250,000 per night', 'NGN')).toEqual(money(25_000_000n, 'NGN'));
    expect(priceFromText('$120', 'USD')).toEqual(money(12_000n, 'USD'));
    expect(priceFromText('£85.5', 'NGN')).toEqual(money(8_550n, 'GBP'));
    expect(priceFromText('1.250,50 €', 'NGN')).toEqual(money(125_050n, 'EUR'));
    expect(priceFromText('KSh 12,500', 'KES')).toEqual(money(1_250_000n, 'KES'));
  });

  it('gives nothing for text that is not one clear, positive amount', () => {
    for (const text of [
      '',
      'Sold out',
      '0',
      '0.00',
      '120 - 180',
      '2 nights from ₦250,000',
      'x'.repeat(81),
    ]) {
      expect([text, priceFromText(text, 'NGN')]).toEqual([text, null]);
    }
  });
});

describe('judging an observation (ADR-102)', () => {
  const base = {
    price: money(25_000_000n, 'NGN'),
    method: 'structured_data',
    marketCurrency: 'NGN',
    taxesIncluded: true,
    history: [24_000_000n, 25_500_000n, 26_000_000n, 25_000_000n, 24_500_000n],
  } as const;

  it('verifies a structured price in the market currency that sits with its history', () => {
    expect(judgeObservation(base)).toEqual({ confidence: 90, flags: [], status: 'verified' });
  });

  it('rejects a price that is not positive', () => {
    expect(judgeObservation({ ...base, price: money(0n, 'NGN') }).status).toBe('rejected');
  });

  it('never verifies a price in another currency or far below its history', () => {
    const foreign = judgeObservation({ ...base, price: money(25_000_000n, 'USD') });
    expect(foreign.flags).toContain('currency_mismatch');
    expect(foreign.status).not.toBe('verified');
    const low = judgeObservation({ ...base, price: money(2_500_000n, 'NGN') });
    expect(low.flags).toContain('outlier_low');
    expect(low.status).not.toBe('verified');
    const high = judgeObservation({ ...base, price: money(90_000_000n, 'NGN') });
    expect(high.flags).toContain('outlier_high');
  });

  it('trusts a model-read price least and marks what it does not know', () => {
    const judged = judgeObservation({ ...base, method: 'model', taxesIncluded: null, history: [] });
    expect(judged.flags).toEqual(['low_confidence_method', 'taxes_unknown', 'no_history']);
    expect(judged.status).toBe('rejected');
    const selectors = judgeObservation({ ...base, method: 'selectors', history: [] });
    expect(selectors).toEqual({ confidence: 65, flags: ['no_history'], status: 'unverified' });
  });

  it('gains from a second source that agrees and loses from one that does not', () => {
    const agree = judgeObservation({ ...base, method: 'selectors', otherSource: 26_000_000n });
    expect(agree).toEqual({ confidence: 85, flags: [], status: 'verified' });
    const differ = judgeObservation({ ...base, method: 'selectors', otherSource: 40_000_000n });
    expect(differ.flags).toEqual(['sources_disagree']);
    expect(differ.status).toBe('unverified');
  });
});

describe('budgets and night windows (ADR-102)', () => {
  it('names the highest threshold a spend has reached', () => {
    expect(budgetAlertLevel(0, 1000)).toBeNull();
    expect(budgetAlertLevel(499, 1000)).toBeNull();
    expect(budgetAlertLevel(500, 1000)).toBe(50);
    expect(budgetAlertLevel(799, 1000)).toBe(50);
    expect(budgetAlertLevel(800, 1000)).toBe(80);
    expect(budgetAlertLevel(1000, 1000)).toBe(100);
    expect(budgetAlertLevel(5000, 1000)).toBe(100);
    expect(budgetAlertLevel(10, 0)).toBeNull();
  });

  it('knows a night that wraps midnight', () => {
    expect([22, 23, 0, 4, 5, 12].map((hour) => inNightWindow(hour, 23, 5))).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect([0, 1, 5, 6].map((hour) => inNightWindow(hour, 1, 6))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(inNightWindow(13, 0, 0)).toBe(true);
  });
});
