import { describe, expect, it } from 'vitest';

import {
  emptyPassenger,
  flightFacts,
  normalisePassport,
  normalisePhone,
  validateCheckout,
  type CheckoutDraft,
  type FlightFactsInput,
  type PassengerDraft,
} from './checkout-draft';
import type { ItineraryFacts } from './passenger-rules';

const adult = (patch: Partial<PassengerDraft> = {}): PassengerDraft => ({
  ...emptyPassenger('adult'),
  title: 'mr',
  gender: 'm',
  givenNames: 'Adébáyọ̀',
  surname: 'Okafor',
  dateOfBirth: '1990-04-21',
  nationality: 'NG',
  ...patch,
});

const draft = (patch: Partial<CheckoutDraft> = {}): CheckoutDraft => ({
  passengers: [adult()],
  guests: [],
  email: 'ada@example.com',
  phone: '+234 803 000 0000',
  terms: true,
  ...patch,
});

const domestic: ItineraryFacts = {
  counts: { adults: 1, children: 0, infants: 0 },
  firstTravelDate: '2026-11-02',
  lastTravelDate: '2026-11-09',
  international: false,
};

describe('validateCheckout', () => {
  it('accepts a complete domestic booking without a passport', () => {
    expect(validateCheckout(draft(), domestic)).toEqual({ errors: {}, warnings: {} });
  });

  it('reports each missing field on its path', () => {
    const { errors } = validateCheckout(
      draft({ passengers: [emptyPassenger('adult')], email: '', phone: '', terms: false }),
      null,
    );
    expect(errors).toEqual({
      'passengers.0.givenNames': 'required',
      'passengers.0.surname': 'required',
      'passengers.0.title': 'required',
      'passengers.0.gender': 'required',
      'passengers.0.nationality': 'required',
      'passengers.0.dateOfBirth': 'required',
      email: 'required',
      phone: 'required',
      terms: 'terms',
    });
  });

  it('rejects names outside the Latin script and malformed contact details', () => {
    const { errors } = validateCheckout(
      draft({
        passengers: [adult({ givenNames: 'Анна' })],
        email: 'ada@example',
        phone: '0803 000 0000',
      }),
      domestic,
    );
    expect(errors).toMatchObject({
      'passengers.0.givenNames': 'name_not_latin',
      email: 'email',
      phone: 'phone',
    });
  });

  it('requires all passport fields once one is filled', () => {
    const { errors } = validateCheckout(
      draft({ passengers: [adult({ passportNumber: 'a1-234' })] }),
      domestic,
    );
    expect(errors).toMatchObject({
      'passengers.0.issuingCountry': 'required',
      'passengers.0.passportExpiry': 'required',
    });
    expect(errors['passengers.0.passportNumber']).toBeUndefined();
  });

  it('requires a passport abroad and warns when it expires within six months', () => {
    const international = { ...domestic, international: true };
    expect(validateCheckout(draft(), international).errors).toEqual({
      'passengers.0.passportNumber': 'passport_required',
    });

    const soon = adult({
      passportNumber: 'A12345678',
      issuingCountry: 'NG',
      passportExpiry: '2027-01-15',
    });
    expect(validateCheckout(draft({ passengers: [soon] }), international)).toEqual({
      errors: {},
      warnings: { 'passengers.0.passportExpiry': 'passport_expires_soon' },
    });

    const expired = { ...soon, passportExpiry: '2026-11-05' };
    expect(validateCheckout(draft({ passengers: [expired] }), international).errors).toEqual({
      'passengers.0.passportExpiry': 'passport_expired',
    });
  });

  it('checks ages and counts against the priced offer', () => {
    const facts = { ...domestic, counts: { adults: 1, children: 1, infants: 0 } };
    const { errors } = validateCheckout(
      draft({
        passengers: [adult(), { ...adult({ dateOfBirth: '1995-01-01' }), type: 'child' }],
      }),
      facts,
    );
    expect(errors).toEqual({ 'passengers.1.dateOfBirth': 'passenger_type_mismatch' });

    expect(validateCheckout(draft(), facts).errors).toEqual({
      passengers: 'passenger_count_mismatch',
    });
  });

  it('checks hotel guest names', () => {
    const { errors } = validateCheckout(
      draft({ passengers: [], guests: [{ givenNames: '', surname: 'Okafor' }] }),
      null,
    );
    expect(errors).toEqual({ 'guests.0.givenNames': 'required' });
  });
});

describe('normalisers', () => {
  it('strips separators from passports and phone numbers', () => {
    expect(normalisePassport(' a12-345 678 ')).toBe('A12345678');
    expect(normalisePhone('+234 (803) 000-0000')).toBe('+2348030000000');
  });
});

describe('flightFacts', () => {
  const segment = (from: string | null, to: string | null) => ({
    origin: { countryCode: from },
    destination: { countryCode: to },
  });
  const offer = (slices: FlightFactsInput['slices']): FlightFactsInput => ({
    passengers: { adults: 2, children: 1, infants: 0 },
    slices,
  });

  it('takes travel dates from the first and last slices', () => {
    const facts = flightFacts(
      offer([
        { departureLocal: '2026-11-02T07:30', segments: [segment('NG', 'NG')] },
        { departureLocal: '2026-11-09T18:00', segments: [segment('NG', 'NG')] },
      ]),
    );
    expect(facts).toEqual({
      counts: { adults: 2, children: 1, infants: 0 },
      firstTravelDate: '2026-11-02',
      lastTravelDate: '2026-11-09',
      international: false,
    });
  });

  it('treats a border crossing or an unknown country as international', () => {
    expect(
      flightFacts(offer([{ departureLocal: '2026-11-02T07:30', segments: [segment('NG', 'AE')] }]))
        .international,
    ).toBe(true);
    expect(
      flightFacts(offer([{ departureLocal: '2026-11-02T07:30', segments: [segment('NG', null)] }]))
        .international,
    ).toBe(true);
  });
});
