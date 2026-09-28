import {
  addMonths,
  buildMonthGrid,
  dayPosition,
  isBeforeDay,
  selectDay,
  weekdayLabels,
} from './calendar';

const d = (day: number, month = 9, year = 2026): Date => new Date(year, month, day);

describe('buildMonthGrid', () => {
  it('lays out October 2026 starting on Monday (1 Oct is a Thursday)', () => {
    const grid = buildMonthGrid(2026, 9, 1);
    expect(grid[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[0]?.[3]?.getDate()).toBe(1);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
  });

  it('respects Sunday-first weeks', () => {
    expect(buildMonthGrid(2026, 9, 0)[0]?.[4]?.getDate()).toBe(1);
  });

  it('handles leap-year February', () => {
    expect(buildMonthGrid(2028, 1).flat().filter(Boolean)).toHaveLength(29);
  });
});

describe('selectDay', () => {
  it('single mode always replaces the date', () => {
    expect(selectDay({ from: d(1) }, d(5), 'single')).toEqual({ from: d(5), to: undefined });
  });

  it('range mode: first tap starts, second tap ends', () => {
    const started = selectDay({ from: undefined }, d(12), 'range');
    expect(started).toEqual({ from: d(12), to: undefined });
    expect(selectDay(started, d(19), 'range')).toEqual({ from: d(12), to: d(19) });
  });

  it('range mode: tapping before the start, or after a full range, starts over', () => {
    expect(selectDay({ from: d(12) }, d(10), 'range')).toEqual({ from: d(10), to: undefined });
    expect(selectDay({ from: d(12), to: d(19) }, d(25), 'range')).toEqual({
      from: d(25),
      to: undefined,
    });
  });

  it('allows same-day return (day trip)', () => {
    expect(selectDay({ from: d(12) }, d(12), 'range')).toEqual({ from: d(12), to: d(12) });
  });
});

describe('dayPosition', () => {
  const range = { from: d(12), to: d(19) };

  it('marks start, middle, end and outside days', () => {
    expect(dayPosition(d(12), range)).toBe('start');
    expect(dayPosition(d(15), range)).toBe('middle');
    expect(dayPosition(d(19), range)).toBe('end');
    expect(dayPosition(d(20), range)).toBe('none');
  });

  it('treats an open or same-day range as a single day', () => {
    expect(dayPosition(d(12), { from: d(12) })).toBe('single');
    expect(dayPosition(d(12), { from: d(12), to: d(12) })).toBe('single');
  });
});

describe('helpers', () => {
  it('addMonths rolls over years', () => {
    expect(addMonths(d(31, 11), 1)).toEqual(new Date(2027, 0, 1));
  });

  it('isBeforeDay ignores time of day', () => {
    expect(isBeforeDay(new Date(2026, 9, 12, 23, 59), new Date(2026, 9, 12, 0, 1))).toBe(false);
  });

  it('weekdayLabels starts on the requested day', () => {
    expect(weekdayLabels('en-GB', 1)[0]).toBe('Mon');
    expect(weekdayLabels('en-US', 0)[0]).toBe('Sun');
  });
});
