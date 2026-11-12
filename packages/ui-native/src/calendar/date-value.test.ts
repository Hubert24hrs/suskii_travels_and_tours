import {
  clampDay,
  dayInRange,
  fromIsoDay,
  HOURS,
  joinDateValue,
  minuteOptions,
  monthInRange,
  NO_PARTS,
  rowsOf,
  shiftMonth,
  splitDateValue,
  toIsoDay,
  yearsBetween,
} from './date-value';

describe('date values', () => {
  it('reads only real days', () => {
    expect(fromIsoDay('1990-04-21')).toEqual(new Date(1990, 3, 21));
    expect(fromIsoDay('2028-02-29')).toEqual(new Date(2028, 1, 29));
    expect(fromIsoDay('2026-02-29')).toBeUndefined();
    expect(fromIsoDay('2026-13-01')).toBeUndefined();
    expect(fromIsoDay('1990-4-21')).toBeUndefined();
    expect(fromIsoDay('')).toBeUndefined();
    expect(toIsoDay(new Date(1990, 3, 1))).toBe('1990-04-01');
  });

  it('splits a value of its mode, and nothing else', () => {
    expect(splitDateValue('1990-04-21', 'date')).toEqual({ ...NO_PARTS, day: '1990-04-21' });
    expect(splitDateValue('2026-12-01T14:30', 'dateTime')).toEqual({
      day: '2026-12-01',
      hour: '14',
      minute: '30',
    });
    expect(splitDateValue('2026-12-01', 'dateTime')).toBeNull();
    expect(splitDateValue('2026-12-01T14:30', 'date')).toBeNull();
    expect(splitDateValue('2026-12-01T24:00', 'dateTime')).toBeNull();
    expect(splitDateValue('2026-12-01T10:60', 'dateTime')).toBeNull();
    expect(splitDateValue('', 'date')).toBeNull();
  });

  it('joins the value the API takes once every part is chosen', () => {
    expect(joinDateValue({ ...NO_PARTS, day: '1990-04-21' }, 'date')).toBe('1990-04-21');
    expect(joinDateValue({ day: '2026-12-01', hour: '09', minute: '05' }, 'dateTime')).toBe(
      '2026-12-01T09:05',
    );
    expect(joinDateValue({ day: '2026-12-01', hour: '09', minute: '' }, 'dateTime')).toBeNull();
    expect(joinDateValue({ day: '', hour: '09', minute: '00' }, 'dateTime')).toBeNull();
    expect(joinDateValue(NO_PARTS, 'date')).toBeNull();
  });

  it('keeps days and months within the range', () => {
    expect(dayInRange('2026-11-12', '2026-11-12', '2027-11-12')).toBe(true);
    expect(dayInRange('2026-11-11', '2026-11-12', '2027-11-12')).toBe(false);
    expect(clampDay('2026-01-01', '2026-11-12', '2027-11-12')).toBe('2026-11-12');
    expect(clampDay('2030-01-01', '2026-11-12', '2027-11-12')).toBe('2027-11-12');
    expect(monthInRange('2026-11', '2026-11-30', '2027-01-01')).toBe(true);
    expect(monthInRange('2026-10', '2026-11-30', '2027-01-01')).toBe(false);
    expect(monthInRange('2027-01', '2026-11-30', '2027-01-01')).toBe(true);
  });

  it('moves between months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('1990-04', 0)).toBe('1990-04');
  });

  it('lists years from the end nearer today', () => {
    // A date of birth: this year first.
    expect(yearsBetween('1906-11-12', '2026-11-12', '2026-11-12').slice(0, 3)).toEqual([
      2026, 2025, 2024,
    ]);
    // An expiry date: this year first, then later years.
    expect(yearsBetween('2026-11-12', '2046-11-12', '2026-11-12').slice(0, 3)).toEqual([
      2026, 2027, 2028,
    ]);
    expect(yearsBetween('1906-11-12', '2026-11-12', '2026-11-12')).toHaveLength(121);
  });

  it('offers the 24 hour clock and minutes on a step, keeping a chosen minute off it', () => {
    expect(HOURS).toHaveLength(24);
    expect(HOURS[0]).toBe('00');
    expect(HOURS[23]).toBe('23');
    expect(minuteOptions(5, '')).toHaveLength(12);
    expect(minuteOptions(15, '30')).toEqual(['00', '15', '30', '45']);
    expect(minuteOptions(15, '37')).toEqual(['00', '15', '30', '37', '45']);
  });

  it('lays items out in rows', () => {
    expect(rowsOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
