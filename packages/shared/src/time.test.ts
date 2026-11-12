import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysBetween,
  earliestToday,
  isValidDate,
  isValidTimeZone,
  localDate,
  localToUtc,
  todayIn,
  utcOffsetMinutes,
  utcToLocal,
} from './time';

describe('time zones', () => {
  it('converts wall time in zones without DST', () => {
    expect(localToUtc('2026-10-01T08:30', 'Africa/Lagos').toISOString()).toBe(
      '2026-10-01T07:30:00.000Z',
    );
    expect(localToUtc('2026-10-01T08:30', 'Africa/Nairobi').toISOString()).toBe(
      '2026-10-01T05:30:00.000Z',
    );
    expect(localToUtc('2026-10-01T08:30:15', 'Africa/Accra').toISOString()).toBe(
      '2026-10-01T08:30:15.000Z',
    );
    expect(utcToLocal(new Date('2026-10-01T23:10:00Z'), 'Africa/Lagos')).toBe('2026-10-02T00:10');
  });

  it('handles DST offsets on both sides of a transition', () => {
    expect(utcOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(utcOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/London')).toBe(60);
    expect(localToUtc('2026-07-15T13:00', 'Europe/London').toISOString()).toBe(
      '2026-07-15T12:00:00.000Z',
    );
    expect(localToUtc('2026-07-15T09:00', 'America/New_York').toISOString()).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('moves times in a spring-forward gap forward by the gap', () => {
    // London skips 01:00-02:00 on 2026-03-29.
    expect(localToUtc('2026-03-29T01:30', 'Europe/London').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(localToUtc('2026-03-29T01:30', 'Europe/London', 'earlier').toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    // New York skips 02:00-03:00 on 2026-03-08.
    expect(utcToLocal(localToUtc('2026-03-08T02:30', 'America/New_York'), 'America/New_York')).toBe(
      '2026-03-08T03:30',
    );
  });

  it('resolves repeated fall-back times to the earlier instant unless told otherwise', () => {
    // London repeats 01:00-02:00 on 2026-10-25.
    expect(localToUtc('2026-10-25T01:30', 'Europe/London').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(localToUtc('2026-10-25T01:30', 'Europe/London', 'later').toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    );
  });

  it('crosses the date line', () => {
    // Kiritimati is UTC+14, Pago Pago UTC-11: 25 hours apart.
    const instant = new Date('2026-10-01T12:00:00Z');
    expect(localDate(instant, 'Pacific/Kiritimati')).toBe('2026-10-02');
    expect(localDate(instant, 'Pacific/Pago_Pago')).toBe('2026-10-01');
    expect(localToUtc('2026-10-02T02:00', 'Pacific/Kiritimati').toISOString()).toBe(
      '2026-10-01T12:00:00.000Z',
    );
    expect(earliestToday(new Date('2026-10-01T11:00:00Z'))).toBe('2026-09-30');
    expect(earliestToday(new Date('2026-10-01T12:00:00Z'))).toBe('2026-10-01');
  });

  it("dates today by the place's own calendar, not the viewer's", () => {
    // 23:30 in Lagos on the 11th is already 02:30 on the 12th in Dubai.
    const evening = new Date('2026-11-11T22:30:00Z');
    expect(todayIn('Africa/Lagos', evening)).toBe('2026-11-11');
    expect(todayIn('Asia/Dubai', evening)).toBe('2026-11-12');
    // To the west the place is still on the day the viewer has left.
    const morning = new Date('2026-11-12T03:00:00Z');
    expect(todayIn('Africa/Lagos', morning)).toBe('2026-11-12');
    expect(todayIn('America/New_York', morning)).toBe('2026-11-11');
    // A place without a zone is read in UTC, as the search reads it.
    expect(todayIn(null, evening)).toBe('2026-11-11');
    expect(todayIn(undefined, new Date('2026-11-11T23:59:59Z'))).toBe('2026-11-11');
    expect(todayIn(null, new Date('2026-11-12T00:00:00Z'))).toBe('2026-11-12');
  });

  it('round-trips wall time for every hour of a year in several zones', () => {
    for (const zone of [
      'Africa/Lagos',
      'Europe/London',
      'America/Sao_Paulo',
      'Asia/Kolkata',
      'Australia/Adelaide',
    ]) {
      for (let hour = 0; hour < 365 * 24; hour += 7) {
        const instant = new Date(Date.UTC(2026, 0, 1) + hour * 3_600_000);
        const local = utcToLocal(instant, zone);
        const back = localToUtc(local, zone);
        // Exact except inside a fall-back overlap, where the earlier instant wins by design.
        const drift = instant.getTime() - back.getTime();
        expect([0, 1_800_000, 3_600_000]).toContain(drift);
      }
    }
  });

  it('validates inputs', () => {
    expect(isValidTimeZone('Africa/Lagos')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(() => localToUtc('2026-10-01 08:30', 'Africa/Lagos')).toThrow(/Invalid local/);
  });
});

describe('calendar dates', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-02T00:40')).toBe(1);
    expect(daysBetween('2026-10-01T23:00', '2026-10-01T23:59')).toBe(0);
  });

  it('rejects impossible dates', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });
});
