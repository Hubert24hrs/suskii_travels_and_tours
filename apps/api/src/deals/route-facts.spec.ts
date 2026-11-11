import { daysBefore, fareTrend, summariseFares, type FareRow } from './route-facts';

const TODAY = new Date('2026-10-28T09:00:00Z');

function fare(daysAgo: number, usd: number, overrides: Partial<FareRow> = {}): FareRow {
  const observedOn = daysBefore(TODAY, daysAgo);
  return {
    observedOn,
    departureDate: new Date(observedOn.getTime() + 21 * 86_400_000),
    supplier: 'duffel',
    carrierCode: 'KQ',
    carrierName: 'Kenya Airways',
    stops: 1,
    durationMinutes: 600,
    usdMinor: BigInt(usd),
    updatedAt: new Date(observedOn.getTime() + 3_600_000),
    ...overrides,
  };
}

describe('summariseFares', () => {
  it('needs enough observation days in the last 90 before saying anything', () => {
    const rows = [fare(0, 500_00), fare(1, 520_00)];
    expect(summariseFares(rows, TODAY, 3)).toBeNull();
    expect(summariseFares([...rows, fare(95, 400_00)], TODAY, 3)).toBeNull();
    expect(summariseFares([...rows, fare(2, 480_00)], TODAY, 3)).not.toBeNull();
  });

  it('takes the cheapest of the last 30 days and the median of daily cheapest fares', () => {
    const rows = [
      fare(0, 600_00),
      fare(0, 550_00), // the day's cheapest
      fare(10, 500_00),
      fare(40, 300_00), // cheaper, but older than 30 days
      fare(50, 700_00),
    ];
    const summary = summariseFares(rows, TODAY, 3);
    expect(summary?.cheapest.usdMinor).toBe(500_00n);
    // Daily cheapest: 300, 500, 550, 700 → lower median 500 (a real fare, never an average).
    expect(summary?.typical.usdMinor).toBe(500_00n);
    expect(summary?.observedDays).toBe(4);
  });

  it('falls back to the cheapest day of 90 when nothing was found in the last 30', () => {
    const rows = [fare(40, 300_00), fare(50, 700_00), fare(60, 400_00)];
    expect(summariseFares(rows, TODAY, 3)?.cheapest.usdMinor).toBe(300_00n);
  });

  it('lists airlines by how often they were seen, with names from the airlines table', () => {
    const rows = [
      fare(0, 500_00, { carrierCode: 'ET', carrierName: 'ETHIOPIAN' }),
      fare(1, 500_00, { carrierCode: 'ET', carrierName: 'ETHIOPIAN' }),
      fare(2, 500_00),
    ];
    const summary = summariseFares(rows, TODAY, 3, new Map([['ET', 'Ethiopian Airlines']]));
    expect(summary?.airlines).toEqual([
      { code: 'ET', name: 'Ethiopian Airlines' },
      { code: 'KQ', name: 'Kenya Airways' },
    ]);
  });

  it('reports a direct flight and the fastest journey seen in 90 days', () => {
    const rows = [
      fare(0, 500_00),
      fare(1, 900_00, { stops: 0, durationMinutes: 390 }),
      fare(2, 500_00),
      fare(120, 500_00, { stops: 0, durationMinutes: 300 }),
    ];
    const summary = summariseFares(rows, TODAY, 3);
    expect(summary?.direct).toBe(true);
    expect(summary?.fastestMinutes).toBe(390);
    expect(summariseFares([fare(0, 1), fare(1, 1), fare(2, 1)], TODAY, 3)?.direct).toBe(false);
  });

  it('names the cheapest month only once three departure months were seen', () => {
    const month = (m: number) => new Date(Date.UTC(2026, m - 1, 15));
    const base = [
      fare(0, 800_00, { departureDate: month(11) }),
      fare(1, 820_00, { departureDate: month(11) }),
      fare(30, 450_00, { departureDate: month(10) }),
    ];
    expect(summariseFares(base, TODAY, 3)?.cheapestMonth).toBeNull();
    const withThird = [...base, fare(60, 600_00, { departureDate: month(9) })];
    expect(summariseFares(withThird, TODAY, 3)?.cheapestMonth).toBe(10);
  });

  it('marks facts built from sample fares', () => {
    const rows = [fare(0, 1), fare(1, 1), fare(2, 1, { supplier: 'mock' })];
    expect(summariseFares(rows, TODAY, 3)?.sample).toBe(true);
  });
});

describe('fareTrend', () => {
  const window = (from: number, usd: number, days = 5): FareRow[] =>
    Array.from({ length: days }, (_, index) => fare(from + index, usd));

  it('says nothing until both the last month and the two before it have enough days', () => {
    expect(fareTrend([], TODAY)).toBeNull();
    expect(fareTrend(window(0, 500_00), TODAY)).toBeNull();
    expect(fareTrend([...window(0, 500_00), ...window(40, 500_00, 4)], TODAY)).toBeNull();
    expect(fareTrend([...window(0, 500_00, 4), ...window(40, 500_00)], TODAY)).toBeNull();
    // Fares older than 90 days are not history any more.
    expect(fareTrend([...window(0, 500_00), ...window(95, 900_00)], TODAY)).toBeNull();
  });

  it('compares the median of daily cheapest fares, with a band either side for steady', () => {
    const earlier = window(40, 500_00);
    expect(fareTrend([...window(0, 400_00), ...earlier], TODAY)).toBe('lower');
    expect(fareTrend([...window(0, 600_00), ...earlier], TODAY)).toBe('higher');
    expect(fareTrend([...window(0, 510_00), ...earlier], TODAY)).toBe('steady');
    expect(fareTrend([...window(0, 475_00), ...earlier], TODAY)).toBe('steady');
    expect(fareTrend([...window(0, 474_99), ...earlier], TODAY)).toBe('lower');
    expect(fareTrend([...window(0, 525_01), ...earlier], TODAY)).toBe('higher');
  });

  it('reads each day by its cheapest fare, and one odd day does not move the median', () => {
    const recent = [
      ...window(0, 500_00),
      fare(0, 900_00), // a dearer fare on a day that also had a cheaper one
      fare(6, 100_00), // one very cheap day among six
    ];
    expect(fareTrend([...recent, ...window(40, 500_00)], TODAY)).toBe('steady');
  });
});
