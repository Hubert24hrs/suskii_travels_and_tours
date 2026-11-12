import type { Redis } from 'ioredis';

import type { AppConfig } from '../config/config';
import type { PrismaService } from '../infra/prisma.service';
import { breakerMarkKey } from '../suppliers/breaker-marks';

import {
  StatusService,
  applyIncidents,
  measuredStates,
  type Measurements,
  type PublicIncident,
} from './status.service';

const healthy: Measurements = {
  database: true,
  redis: true,
  flights: { total: 2, failing: 0 },
  hotels: { total: 1, failing: 0 },
  payments: { total: 2, paused: 0 },
  ticketingWaitMinutes: 0,
};

const incident = (overrides: Partial<PublicIncident> = {}): PublicIncident => ({
  id: '0190f6a2-0000-7000-8000-000000000001',
  title: 'Card payments failing',
  impact: 'minor',
  status: 'investigating',
  components: ['payments'],
  startedAt: '2026-10-28T10:00:00.000Z',
  resolvedAt: null,
  updates: [],
  ...overrides,
});

describe('measured component states', () => {
  it('reports everything operational when all checks pass', () => {
    expect(Object.values(measuredStates(healthy))).toEqual(Array(5).fill('operational'));
  });

  it('degrades search when some suppliers fail and calls an outage only when both verticals do', () => {
    expect(measuredStates({ ...healthy, flights: { total: 2, failing: 1 } }).search).toBe(
      'degraded',
    );
    expect(measuredStates({ ...healthy, flights: { total: 2, failing: 2 } }).search).toBe(
      'degraded',
    );
    expect(
      measuredStates({
        ...healthy,
        flights: { total: 2, failing: 2 },
        hotels: { total: 1, failing: 1 },
      }).search,
    ).toBe('outage');
  });

  it('puts what needs the database or Redis in outage when they cannot answer', () => {
    expect(measuredStates({ ...healthy, database: false })).toEqual({
      search: 'operational',
      bookings: 'outage',
      payments: 'outage',
      accounts: 'outage',
      support: 'outage',
    });
    expect(measuredStates({ ...healthy, redis: false })).toMatchObject({
      search: 'outage',
      accounts: 'outage',
      bookings: 'operational',
    });
  });

  it('judges payments by paused providers and bookings by the ticketing wait', () => {
    expect(measuredStates({ ...healthy, payments: { total: 2, paused: 1 } }).payments).toBe(
      'degraded',
    );
    expect(measuredStates({ ...healthy, payments: { total: 2, paused: 2 } }).payments).toBe(
      'outage',
    );
    expect(measuredStates({ ...healthy, ticketingWaitMinutes: 29 }).bookings).toBe('operational');
    expect(measuredStates({ ...healthy, ticketingWaitMinutes: 30 }).bookings).toBe('degraded');
  });
});

describe('incidents on top of measurements', () => {
  const measured = measuredStates(healthy);

  it('makes the components an open incident names at least as bad as its impact', () => {
    const page = applyIncidents(measured, [
      incident({ impact: 'major', components: ['payments', 'bookings'] }),
    ]);
    expect(page.state).toBe('outage');
    expect(page.components).toEqual([
      { id: 'search', state: 'operational' },
      { id: 'bookings', state: 'outage' },
      { id: 'payments', state: 'outage' },
      { id: 'accounts', state: 'operational' },
      { id: 'support', state: 'operational' },
    ]);
  });

  it('never makes a measured outage look better, and ignores resolved incidents', () => {
    const page = applyIncidents({ ...measured, payments: 'outage' }, [
      incident({ impact: 'minor' }),
      incident({ impact: 'major', components: ['search'], resolvedAt: '2026-10-28T11:00:00Z' }),
    ]);
    expect(page.components.find((c) => c.id === 'payments')?.state).toBe('outage');
    expect(page.components.find((c) => c.id === 'search')?.state).toBe('operational');
  });
});

describe('StatusService', () => {
  const config = {
    FLIGHT_SUPPLIERS: ['mock', 'duffel'],
    HOTEL_SUPPLIERS: ['mock'],
    PAYMENT_PROVIDERS: ['mock'],
    PAYMENT_PROVIDERS_PAUSED: [],
  } as unknown as AppConfig;

  function fakes(options: { database?: boolean; marks?: string[] } = {}) {
    const store = new Map<string, string>();
    for (const key of options.marks ?? []) store.set(key, '1');
    const redis = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: jest.fn((key: string) => Promise.resolve(store.delete(key) ? 1 : 0)),
      ping: jest.fn(() => Promise.resolve('PONG')),
      mget: jest.fn((keys: string[]) => Promise.resolve(keys.map((key) => store.get(key) ?? null))),
    };
    const down = () => Promise.reject(new Error('connection refused'));
    const rows = [
      {
        id: '0190f6a2-0000-7000-8000-000000000009',
        title: 'Slow hotel search',
        impact: 'minor',
        status: 'identified',
        components: ['search', 'not-a-component'],
        startedAt: new Date('2026-10-28T09:00:00Z'),
        resolvedAt: null,
        createdAt: new Date('2026-10-28T09:00:00Z'),
        updatedAt: new Date('2026-10-28T09:30:00Z'),
        updates: [
          {
            id: 'u1',
            incidentId: '0190f6a2-0000-7000-8000-000000000009',
            status: 'identified',
            message: 'A supplier answers slowly.',
            createdAt: new Date('2026-10-28T09:30:00Z'),
          },
        ],
      },
    ];
    const prisma = {
      $queryRaw: jest.fn(() => (options.database === false ? down() : Promise.resolve([1]))),
      statusIncident: {
        findMany: jest.fn((args: { where: { resolvedAt: unknown } }) =>
          options.database === false
            ? down()
            : Promise.resolve(args.where.resolvedAt === null ? rows : []),
        ),
      },
      booking: {
        findFirst: jest.fn(() => (options.database === false ? down() : Promise.resolve(null))),
      },
    };
    const service = new StatusService(
      prisma as unknown as PrismaService,
      redis as unknown as Redis,
      config,
    );
    return { service, redis, prisma, store };
  }

  it('measures once, caches the page for every instance and applies open incidents', async () => {
    const { service, prisma, redis } = fakes({ marks: [breakerMarkKey('flights:duffel')] });
    const now = new Date('2026-10-28T12:00:00Z');
    const page = await service.current(now);
    expect(page.components.find((c) => c.id === 'search')?.state).toBe('degraded');
    expect(page.incidents).toEqual([
      expect.objectContaining({
        title: 'Slow hotel search',
        components: ['search'],
        updates: [
          {
            status: 'identified',
            message: 'A supplier answers slowly.',
            createdAt: '2026-10-28T09:30:00.000Z',
          },
        ],
      }),
    ]);
    expect(page.updatedAt).toBe('2026-10-28T12:00:00.000Z');
    expect(redis.set).toHaveBeenCalledWith('status:snapshot', expect.any(String), 'EX', 30);

    await service.current(now);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    await service.invalidate();
    await service.current(now);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('still answers when the database is down, with the last incidents it read', async () => {
    const first = fakes();
    await first.service.current(new Date('2026-10-28T12:00:00Z'));
    const saved = first.store.get('status:incidents');

    const { service, store } = fakes({ database: false });
    if (saved) store.set('status:incidents', saved);
    const page = await service.current(new Date('2026-10-28T12:01:00Z'));
    expect(page.state).toBe('outage');
    expect(page.components.find((c) => c.id === 'bookings')?.state).toBe('outage');
    expect(page.incidents.map((i) => i.title)).toEqual(['Slow hotel search']);
  });
});
