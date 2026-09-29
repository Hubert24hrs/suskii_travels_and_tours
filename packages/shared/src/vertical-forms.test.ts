import { describe, expect, it } from 'vitest';

import { SEARCH_ISSUES } from './search';
import {
  addonsFormToParams,
  createAddonsFormSchema,
  createPackagesFormSchema,
  createToursFormSchema,
  createVisaFormSchema,
  packagesFormToParams,
  parseAddonsParams,
  parsePackagesParams,
  parseToursParams,
  parseVisaParams,
  toursFormToParams,
  VERTICAL_FORM_ISSUES,
  visaFormToParams,
} from './vertical-forms';

const now = () => new Date('2026-10-01T12:00:00Z');
const CITY = '01a0ea71-38e9-7127-b812-1b5f35f5212b';
const travellers = { adults: 2, children: 1, infants: 0 };

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('packages form', () => {
  const schema = createPackagesFormSchema({ now });

  it('accepts a month or a date range, with an optional budget', () => {
    const month = schema.parse({
      cityId: CITY,
      when: { type: 'month', month: '2026-12' },
      travellers,
      budget: { currency: 'NGN', min: null, max: 1_500_000 },
    });
    expect(parsePackagesParams(packagesFormToParams(month), { now }).form).toEqual(month);
    expect(packagesFormToParams(month).toString()).toBe(
      `dest=${CITY}&month=2026-12&adults=2&children=1&budget=-1500000&cur=NGN`,
    );

    const dates = schema.parse({
      cityId: CITY,
      when: { type: 'dates', from: '2026-11-01', to: '2026-11-08' },
      travellers,
      budget: { currency: 'NGN', min: null, max: null },
    });
    expect(packagesFormToParams(dates).has('budget')).toBe(false);
    expect(parsePackagesParams(packagesFormToParams(dates), { now }).form).toEqual(dates);
  });

  it('rejects past months, reversed ranges and inverted budgets', () => {
    expect(
      messages(
        schema.safeParse({
          cityId: CITY,
          when: { type: 'month', month: '2026-09' },
          travellers,
          budget: { currency: 'NGN', min: 900, max: 100 },
        }),
      ),
    ).toEqual([VERTICAL_FORM_ISSUES.monthInPast, VERTICAL_FORM_ISSUES.budgetMinAboveMax]);
    expect(
      messages(
        schema.safeParse({
          cityId: CITY,
          when: { type: 'dates', from: '2026-11-08', to: '2026-11-01' },
          travellers,
          budget: { currency: 'NGN', min: null, max: null },
        }),
      ),
    ).toEqual([VERTICAL_FORM_ISSUES.endBeforeStart]);
  });
});

describe('tours form', () => {
  const schema = createToursFormSchema({ now });

  it('round-trips and enforces an upcoming date', () => {
    const form = schema.parse({ query: 'Zanzibar spice tour', date: '2026-10-20', travellers });
    expect(parseToursParams(toursFormToParams(form), { now }).form).toEqual(form);
    expect(messages(schema.safeParse({ query: 'x', date: '2026-09-01', travellers }))).toContain(
      SEARCH_ISSUES.dateInPast,
    );
  });
});

describe('visa form', () => {
  const schema = createVisaFormSchema({ now });

  it('round-trips and rejects the traveller’s own country', () => {
    const form = schema.parse({
      nationality: 'NG',
      destination: 'GB',
      purpose: 'study',
      travelDate: '2027-01-15',
    });
    expect(parseVisaParams(visaFormToParams(form), { now }).form).toEqual(form);
    expect(
      messages(
        schema.safeParse({
          nationality: 'NG',
          destination: 'NG',
          purpose: 'tourism',
          travelDate: '2027-01-15',
        }),
      ),
    ).toEqual([VERTICAL_FORM_ISSUES.sameNationalityDestination]);
    expect(parseVisaParams({ nationality: 'ng', purpose: 'holiday' }, { now }).draft).toMatchObject(
      {
        nationality: 'NG',
        purpose: 'tourism',
      },
    );
  });
});

describe('add-ons form', () => {
  const schema = createAddonsFormSchema({ now });

  it('serialises standalone searches and keeps last names out of URLs', () => {
    const standalone = schema.parse({
      mode: 'standalone',
      type: 'esim',
      cityId: CITY,
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      travellers,
    });
    expect(parseAddonsParams(addonsFormToParams(standalone))).toMatchObject({
      mode: 'standalone',
      type: 'esim',
      cityId: CITY,
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      travellers,
    });

    const booking = schema.parse({
      mode: 'booking',
      bookingReference: ' sk3x9q ',
      lastName: 'Okafor',
    });
    const params = addonsFormToParams(booking);
    expect(params.toString()).toBe('booking=SK3X9Q');
    expect(params.toString()).not.toContain('Okafor');
    expect(parseAddonsParams(params)).toMatchObject({
      mode: 'booking',
      bookingReference: 'SK3X9Q',
      lastName: '',
    });
  });

  it('validates dates and references', () => {
    expect(
      messages(
        schema.safeParse({
          mode: 'standalone',
          type: 'lounge',
          cityId: CITY,
          startDate: '2026-11-10',
          endDate: '2026-11-01',
          travellers,
        }),
      ),
    ).toEqual([VERTICAL_FORM_ISSUES.endBeforeStart]);
    expect(
      schema.safeParse({ mode: 'booking', bookingReference: 'AB', lastName: 'Okafor' }).success,
    ).toBe(false);
  });
});
