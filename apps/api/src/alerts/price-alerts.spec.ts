import { alertDates } from './price-alerts.service';

describe('alertDates', () => {
  it('searches an exact date only while it is in the booking window', () => {
    expect(alertDates({ departureDate: '2026-11-02', departureMonth: null }, '2026-10-05')).toEqual(
      ['2026-11-02'],
    );
    expect(alertDates({ departureDate: '2026-10-05', departureMonth: null }, '2026-10-05')).toEqual(
      [],
    );
  });

  it('samples up to four dates a week apart in a month, from tomorrow once it has started', () => {
    expect(alertDates({ departureDate: null, departureMonth: '2026-12' }, '2026-10-05')).toEqual([
      '2026-12-01',
      '2026-12-08',
      '2026-12-15',
      '2026-12-22',
    ]);
    expect(alertDates({ departureDate: null, departureMonth: '2026-10' }, '2026-10-20')).toEqual([
      '2026-10-21',
      '2026-10-28',
    ]);
  });
});
