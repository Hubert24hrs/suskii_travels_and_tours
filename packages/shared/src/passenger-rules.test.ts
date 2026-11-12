import { describe, expect, it } from 'vitest';

import {
  PASSENGER_ISSUES,
  addMonths,
  ageOn,
  checkPassengers,
  passengerTypeForAge,
  transliterateName,
  type ItineraryFacts,
  type PassengerFacts,
} from './passenger-rules';

describe('transliterateName', () => {
  it.each([
    ['Adébáyọ̀', 'ADEBAYO'],
    ['  chioma   ngozi ', 'CHIOMA NGOZI'],
    ['Ọlọ́lá', 'OLOLA'],
    ['Müller-Lüdenscheidt', 'MULLER-LUDENSCHEIDT'],
    ['O’Neill', "O'NEILL"],
    ['Straße', 'STRASSE'],
    ['Łukasz', 'LUKASZ'],
    ['Øystein', 'OYSTEIN'],
    ['Þórunn', 'THORUNN'],
    ['De la Cruz', 'DE LA CRUZ'],
    ['Nguyễn', 'NGUYEN'],
  ])('%s becomes %s', (input, expected) => {
    expect(transliterateName(input)).toBe(expected);
  });

  it.each([['محمد'], ['王小明'], ['Анна'], ['John3'], ['-Ade'], ["Ade'"], [''], ['   ']])(
    'rejects %s',
    (input) => {
      expect(transliterateName(input)).toBeNull();
    },
  );
});

describe('ageOn', () => {
  it('counts whole years', () => {
    expect(ageOn('2000-06-15', '2026-06-14')).toBe(25);
    expect(ageOn('2000-06-15', '2026-06-15')).toBe(26);
  });

  it('treats a 29 February birthday as reached on 1 March', () => {
    expect(ageOn('2024-02-29', '2026-02-28')).toBe(1);
    expect(ageOn('2024-02-29', '2026-03-01')).toBe(2);
  });

  it('maps ages to passenger types', () => {
    expect([0, 1, 2, 11, 12, 80].map(passengerTypeForAge)).toEqual([
      'infant',
      'infant',
      'child',
      'child',
      'adult',
      'adult',
    ]);
  });
});

describe('addMonths', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
  });
});

const trip: ItineraryFacts = {
  counts: { adults: 1, children: 1, infants: 1 },
  firstTravelDate: '2026-12-10',
  lastTravelDate: '2026-12-20',
  international: true,
};
const passport = (expiryDate: string) => ({ expiryDate });
const family: PassengerFacts[] = [
  { type: 'adult', dateOfBirth: '1990-04-01', document: passport('2030-01-01') },
  { type: 'child', dateOfBirth: '2018-05-05', document: passport('2030-01-01') },
  { type: 'infant', dateOfBirth: '2025-06-01', document: passport('2030-01-01') },
];

describe('checkPassengers', () => {
  it('accepts a valid family', () => {
    expect(checkPassengers(family, trip)).toEqual({ errors: [], warnings: [] });
  });

  it('requires infants to be under 2 on the last travel date, not only on departure', () => {
    // Turns 2 on 15 December: an infant on the way out, a child on the way back.
    const result = checkPassengers(
      [family[0]!, family[1]!, { ...family[2]!, dateOfBirth: '2024-12-15' }],
      trip,
    );
    expect(result.errors).toEqual([
      { index: 2, path: ['dateOfBirth'], code: PASSENGER_ISSUES.typeMismatch },
    ]);
  });

  it('rejects travellers born after departure', () => {
    const result = checkPassengers(
      [family[0]!, family[1]!, { ...family[2]!, dateOfBirth: '2026-12-11' }],
      trip,
    );
    expect(result.errors.map((issue) => issue.code)).toEqual([PASSENGER_ISSUES.bornAfterTravel]);
  });

  it('matches the counts the offer was priced for', () => {
    expect(checkPassengers(family.slice(0, 2), trip).errors).toEqual([
      { index: null, path: [], code: PASSENGER_ISSUES.countMismatch },
    ]);
  });

  it('never lets lap infants outnumber adults', () => {
    const infants: PassengerFacts[] = [
      { type: 'adult', dateOfBirth: '1990-04-01', document: null },
      { type: 'infant', dateOfBirth: '2025-06-01', document: null },
      { type: 'infant', dateOfBirth: '2025-07-01', document: null },
    ];
    const domestic = {
      ...trip,
      international: false,
      counts: { adults: 1, children: 0, infants: 2 },
    };
    expect(checkPassengers(infants, domestic).errors).toEqual([
      { index: null, path: [], code: PASSENGER_ISSUES.infantsExceedAdults },
    ]);
  });

  it('requires passports only abroad', () => {
    const noDocuments = family.map((passenger) => ({ ...passenger, document: null }));
    expect(checkPassengers(noDocuments, trip).errors.map((issue) => issue.code)).toEqual([
      PASSENGER_ISSUES.documentRequired,
      PASSENGER_ISSUES.documentRequired,
      PASSENGER_ISSUES.documentRequired,
    ]);
    expect(checkPassengers(noDocuments, { ...trip, international: false }).errors).toEqual([]);
  });

  it('rejects passports that expire during the trip and warns within six months after it', () => {
    const expiring = [
      { ...family[0]!, document: passport('2026-12-19') },
      { ...family[1]!, document: passport('2027-06-19') },
      { ...family[2]!, document: passport('2027-06-20') },
    ];
    const result = checkPassengers(expiring, trip);
    expect(result.errors).toEqual([
      { index: 0, path: ['document', 'expiryDate'], code: PASSENGER_ISSUES.passportExpired },
    ]);
    expect(result.warnings).toEqual([
      { index: 1, path: ['document', 'expiryDate'], code: PASSENGER_ISSUES.passportExpiresSoon },
    ]);
  });
});
