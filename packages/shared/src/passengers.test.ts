import { describe, expect, it } from 'vitest';

import { PASSENGER_ISSUES } from './passenger-rules';
import {
  contactDetailsSchema,
  hotelGuestSchema,
  passengerInputSchema,
  passportNumberSchema,
} from './passengers';

const adult = {
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Adébáyọ̀  Chioma',
  surname: 'Okafor',
  dateOfBirth: '1990-04-01',
  nationality: 'NG',
};

describe('passengerInputSchema', () => {
  it('normalises names and fills defaults', () => {
    expect(passengerInputSchema.parse(adult)).toEqual({
      ...adult,
      givenNames: 'ADEBAYO CHIOMA',
      surname: 'OKAFOR',
      document: null,
      travellerId: null,
      saveTraveller: false,
    });
  });

  it('reports names in other scripts and names that are too long', () => {
    const script = passengerInputSchema.safeParse({ ...adult, surname: 'أوكافور' });
    expect(script.success).toBe(false);
    expect(script.error?.issues[0]).toMatchObject({
      path: ['surname'],
      message: PASSENGER_ISSUES.nameNotLatin,
    });

    const long = passengerInputSchema.safeParse({
      ...adult,
      givenNames: 'A'.repeat(30),
      surname: 'B'.repeat(30),
    });
    expect(long.error?.issues[0]).toMatchObject({
      path: ['surname'],
      message: PASSENGER_ISSUES.nameTooLong,
    });
  });

  it('normalises passport numbers', () => {
    expect(passportNumberSchema.parse(' a12-345 678 ')).toBe('A12345678');
    expect(passportNumberSchema.safeParse('A1').success).toBe(false);
    const parsed = passengerInputSchema.parse({
      ...adult,
      document: { number: 'b 1234567', issuingCountry: 'NG', expiryDate: '2031-01-31' },
    });
    expect(parsed.document).toEqual({
      number: 'B1234567',
      issuingCountry: 'NG',
      expiryDate: '2031-01-31',
    });
  });

  it('lets a saved traveller supply the passport number', () => {
    const document = { issuingCountry: 'NG', expiryDate: '2031-01-31' };
    const missing = passengerInputSchema.safeParse({ ...adult, document });
    expect(missing.error?.issues[0]).toMatchObject({
      path: ['document', 'number'],
      message: PASSENGER_ISSUES.documentRequired,
    });
    const saved = passengerInputSchema.parse({
      ...adult,
      document,
      travellerId: '0199a0f0-0000-7000-8000-000000000001',
    });
    expect(saved.document).toEqual({ ...document, number: null });
  });

  it('rejects unknown titles, genders and malformed dates', () => {
    for (const change of [{ title: 'sir' }, { gender: 'x' }, { dateOfBirth: '1990-02-30' }]) {
      expect(passengerInputSchema.safeParse({ ...adult, ...change }).success).toBe(false);
    }
  });
});

describe('hotelGuestSchema and contactDetailsSchema', () => {
  it('parses a lead guest and contact details', () => {
    expect(hotelGuestSchema.parse({ givenNames: 'Ngozi', surname: 'Eze' })).toEqual({
      givenNames: 'NGOZI',
      surname: 'EZE',
    });
    expect(
      contactDetailsSchema.parse({ email: ' Ngozi@Example.com ', phone: '+2348012345678' }),
    ).toEqual({ email: 'ngozi@example.com', phone: '+2348012345678' });
    expect(contactDetailsSchema.safeParse({ email: 'x', phone: '0801' }).success).toBe(false);
  });
});
