import { CircuitBreaker, type BreakerOptions } from './circuit-breaker';
import { buildSlice, layoversFor } from './itinerary';
import { CircuitOpenError, SupplierTimeoutError, withTimeout } from './supplier.errors';
import type { AirportPoint, FlightSegment } from './supplier.types';

describe('CircuitBreaker', () => {
  let clock = 0;
  const options: BreakerOptions = {
    windowMs: 60_000,
    minimumCalls: 4,
    failureRate: 0.5,
    openMs: 30_000,
    now: () => clock,
  };
  const ok = () => Promise.resolve('ok');
  const fail = () => Promise.reject(new Error('boom'));

  beforeEach(() => {
    clock = 0;
  });

  it('stays closed below the minimum number of calls', async () => {
    const breaker = new CircuitBreaker('test', options);
    for (let i = 0; i < 3; i += 1) await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.state).toBe('closed');
  });

  it('opens at the failure rate, fails fast, then probes once after the cool-down', async () => {
    const breaker = new CircuitBreaker('test', options);
    await breaker.execute(ok);
    await breaker.execute(ok);
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state).toBe('open');

    const task = jest.fn(ok);
    await expect(breaker.execute(task)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(task).not.toHaveBeenCalled();

    clock += 30_000;
    expect(breaker.state).toBe('half_open');
    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.state).toBe('closed');
  });

  it('re-opens when the probe fails and allows only one probe at a time', async () => {
    const breaker = new CircuitBreaker('test', options);
    for (let i = 0; i < 4; i += 1) await expect(breaker.execute(fail)).rejects.toThrow();
    clock += 30_000;
    let release: () => void = () => undefined;
    const slowFailure = breaker.execute(
      () =>
        new Promise<string>((_, reject) => {
          release = () => reject(new Error('still down'));
        }),
    );
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    await expect(slowFailure).rejects.toThrow('still down');
    expect(breaker.state).toBe('open');
  });

  it('forgets failures outside the rolling window', async () => {
    const breaker = new CircuitBreaker('test', options);
    for (let i = 0; i < 3; i += 1) await expect(breaker.execute(fail)).rejects.toThrow();
    clock += 61_000;
    await breaker.execute(ok);
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state).toBe('closed');
  });
});

describe('withTimeout', () => {
  it('rejects with SupplierTimeoutError even when the task ignores its signal', async () => {
    const started = Date.now();
    await expect(
      withTimeout('slow', 50, undefined, () => new Promise(() => undefined)),
    ).rejects.toBeInstanceOf(SupplierTimeoutError);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('aborts the task signal on timeout and passes results through', async () => {
    let aborted = false;
    await expect(
      withTimeout(
        'slow',
        20,
        undefined,
        (signal) =>
          new Promise((resolve) =>
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve('late');
            }),
          ),
      ),
    ).rejects.toBeInstanceOf(SupplierTimeoutError);
    expect(aborted).toBe(true);
    await expect(withTimeout('fast', 1000, undefined, () => Promise.resolve(42))).resolves.toBe(42);
  });

  it('stops when the parent signal aborts', async () => {
    const parent = new AbortController();
    const pending = withTimeout('child', 10_000, parent.signal, () => new Promise(() => undefined));
    parent.abort();
    await expect(pending).rejects.toBeInstanceOf(SupplierTimeoutError);
  });
});

describe('itinerary helpers', () => {
  const airport = (code: string, timeZone = 'Africa/Lagos'): AirportPoint => ({
    code,
    name: code,
    cityName: null,
    countryCode: null,
    timeZone,
  });
  const segment = (
    from: AirportPoint,
    to: AirportPoint,
    dep: string,
    arr: string,
    depLocal: string,
    arrLocal: string,
  ): FlightSegment => ({
    marketingCarrier: { code: 'ET', name: 'Ethiopian Airlines' },
    operatingCarrier: { code: 'ET', name: 'Ethiopian Airlines' },
    flightNumber: '900',
    origin: from,
    destination: to,
    departureLocal: depLocal,
    departureUtc: dep,
    arrivalLocal: arrLocal,
    arrivalUtc: arr,
    durationMinutes: Math.round((Date.parse(arr) - Date.parse(dep)) / 60_000),
    aircraft: null,
    cabinClass: 'economy',
  });

  it('flags short, overnight, long and airport-changing connections', () => {
    const los = airport('LOS');
    const add = airport('ADD', 'Africa/Addis_Ababa');
    const lhr = airport('LHR', 'Europe/London');
    const lgw = airport('LGW', 'Europe/London');
    const tight = layoversFor([
      segment(
        los,
        add,
        '2026-10-01T10:00:00.000Z',
        '2026-10-01T15:00:00.000Z',
        '2026-10-01T11:00',
        '2026-10-01T18:00',
      ),
      segment(
        add,
        lhr,
        '2026-10-01T15:40:00.000Z',
        '2026-10-01T23:30:00.000Z',
        '2026-10-01T18:40',
        '2026-10-02T00:30',
      ),
    ]);
    expect(tight[0]).toMatchObject({ durationMinutes: 40, warnings: ['short_connection'] });

    const overnight = layoversFor([
      segment(
        los,
        add,
        '2026-10-01T18:00:00.000Z',
        '2026-10-01T23:00:00.000Z',
        '2026-10-01T19:00',
        '2026-10-02T02:00',
      ),
      segment(
        add,
        lhr,
        '2026-10-02T06:30:00.000Z',
        '2026-10-02T14:00:00.000Z',
        '2026-10-02T09:30',
        '2026-10-02T15:00',
      ),
    ]);
    expect(overnight[0]?.warnings).toEqual(['overnight', 'long_layover']);

    const crossesMidnight = layoversFor([
      segment(
        los,
        add,
        '2026-10-01T12:00:00.000Z',
        '2026-10-01T19:00:00.000Z',
        '2026-10-01T13:00',
        '2026-10-01T22:00',
      ),
      segment(
        add,
        lhr,
        '2026-10-02T03:30:00.000Z',
        '2026-10-02T11:00:00.000Z',
        '2026-10-02T06:30',
        '2026-10-02T12:00',
      ),
    ]);
    expect(crossesMidnight[0]?.warnings).toEqual(['overnight', 'long_layover']);

    const change = layoversFor([
      segment(
        los,
        lhr,
        '2026-10-01T09:00:00.000Z',
        '2026-10-01T15:30:00.000Z',
        '2026-10-01T10:00',
        '2026-10-01T16:30',
      ),
      segment(
        lgw,
        add,
        '2026-10-01T17:30:00.000Z',
        '2026-10-02T01:00:00.000Z',
        '2026-10-01T18:30',
        '2026-10-02T04:00',
      ),
    ]);
    expect(change[0]?.warnings).toEqual(['short_connection', 'airport_change']);
  });

  it('summarises a slice with stops and the +1 day offset', () => {
    const slice = buildSlice(
      [
        segment(
          airport('LOS'),
          airport('JFK', 'America/New_York'),
          '2026-10-01T22:00:00.000Z',
          '2026-10-02T09:30:00.000Z',
          '2026-10-01T23:00',
          '2026-10-02T05:30',
        ),
      ],
      'Economy Light',
    );
    expect(slice).toMatchObject({
      stops: 0,
      durationMinutes: 690,
      arrivalDayOffset: 1,
      fareBrand: 'Economy Light',
      layovers: [],
    });
  });
});
