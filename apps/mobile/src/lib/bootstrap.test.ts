import { untilStarted } from './bootstrap';
import { reportError } from './error-reporting';

jest.mock('./error-reporting', () => ({ reportError: jest.fn(() => Promise.resolve()) }));

describe('untilStarted', () => {
  beforeEach(() => jest.mocked(reportError).mockClear());

  it('tries again after a failed start, backing off, and reports the first failure once', async () => {
    const locked = new Error('User interaction is not allowed.');
    const start = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked)
      .mockResolvedValueOnce('session');
    const waits: number[] = [];

    const result = await untilStarted(start, {
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    expect(result).toBe('session');
    expect(start).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([500, 1000]);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(locked, { kind: 'bootstrap' });
  });

  it('caps the wait and stops once the screen is gone', async () => {
    let cancelled = false;
    const waits: number[] = [];
    const result = await untilStarted(() => Promise.reject(new Error('locked')), {
      cancelled: () => cancelled,
      wait: (ms) => {
        waits.push(ms);
        if (waits.length === 8) cancelled = true;
        return Promise.resolve();
      },
    });
    expect(result).toBeNull();
    expect(Math.max(...waits)).toBe(5_000);
  });
});
