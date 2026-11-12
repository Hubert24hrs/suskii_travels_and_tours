import type { ObservableResult } from '@opentelemetry/api';

import type { PrismaService } from '../infra/prisma.service';

import { OperationsMetrics } from './operations-metrics';

/** Collects what a gauge callback reports. */
function recorder(): ObservableResult & { values: [number, Record<string, unknown>][] } {
  const values: [number, Record<string, unknown>][] = [];
  return {
    values,
    observe: (value: number, attributes: Record<string, unknown> = {}) => {
      values.push([value, attributes]);
    },
  };
}

interface Readings {
  liveRides(result: ObservableResult): Promise<void>;
  oldestSearch(result: ObservableResult): Promise<void>;
  incidents(result: ObservableResult): Promise<void>;
  documentAge(result: ObservableResult): Promise<void>;
  unscannedTrips(result: ObservableResult): Promise<void>;
}

describe('Cars operational gauges', () => {
  const NOW = new Date('2026-10-24T10:00:00.000Z');
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  function metricsWith(prisma: Record<string, unknown>): Readings {
    return new OperationsMetrics(prisma as unknown as PrismaService) as unknown as Readings;
  }

  it('reports every live ride status, zero included', async () => {
    const groupBy = jest.fn(() => Promise.resolve([{ status: 'searching', _count: { _all: 3 } }]));
    const result = recorder();
    await metricsWith({ ride: { groupBy } }).liveRides(result);
    expect(result.values).toEqual([
      [3, { status: 'searching' }],
      [0, { status: 'assigned' }],
      [0, { status: 'arrived' }],
      [0, { status: 'in_progress' }],
    ]);
  });

  it('measures the oldest search in seconds and reports 0 without one', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ searchStartedAt: new Date(NOW.getTime() - 960_000) })
      .mockResolvedValueOnce(null);
    const metrics = metricsWith({ ride: { findFirst } });
    const stalled = recorder();
    await metrics.oldestSearch(stalled);
    const idle = recorder();
    await metrics.oldestSearch(idle);
    expect(stalled.values).toEqual([[960, {}]]);
    expect(idle.values).toEqual([[0, {}]]);
  });

  it('always reports the open SOS series so its alert can resolve', async () => {
    const groupBy = jest.fn(() =>
      Promise.resolve([{ status: 'acknowledged', kind: 'pin_lockout', _count: { _all: 1 } }]),
    );
    const result = recorder();
    await metricsWith({ safetyIncident: { groupBy } }).incidents(result);
    expect(result.values).toEqual([
      [0, { status: 'open', kind: 'sos' }],
      [1, { status: 'acknowledged', kind: 'pin_lockout' }],
    ]);
  });

  it('ages the oldest document waiting for review', async () => {
    const findFirst = jest.fn(() =>
      Promise.resolve({ createdAt: new Date(NOW.getTime() - 2 * 86_400_000) }),
    );
    const result = recorder();
    await metricsWith({ driverDocument: { findFirst } }).documentAge(result);
    expect(result.values).toEqual([[172_800, {}]]);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'clean' } }));
  });

  it('counts departures past 30 minutes with sold seats and nobody boarded', async () => {
    const count = jest.fn(() => Promise.resolve(2));
    const result = recorder();
    await metricsWith({ busTrip: { count } }).unscannedTrips(result);
    expect(result.values).toEqual([[2, {}]]);
    expect(count).toHaveBeenCalledWith({
      where: {
        status: { in: ['scheduled', 'boarding', 'departed'] },
        departsAt: {
          lte: new Date(NOW.getTime() - 30 * 60_000),
          gte: new Date(NOW.getTime() - 6 * 3_600_000),
        },
        tickets: { some: { status: 'valid' }, none: { status: 'boarded' } },
      },
    });
  });
});
