import { money } from '@suskii/shared';

import {
  NO_RENTAL_SELECTION,
  RENTAL_OPTION_ISSUES,
  rentalOptionCharges,
  rentalOptions,
  rentalRates,
} from './rental-options';

const STORED = {
  currency: 'NGN',
  extras: [
    { code: 'child_seat', dailyMinor: 200_000, max: 2 },
    { code: 'gps', dailyMinor: 150_000, max: 1 },
  ],
  crossBorder: { countries: ['BJ', 'GH'], feeMinor: 5_000_000 },
  returnBranches: [
    {
      code: 'lekki-branch',
      name: 'Lekki branch',
      address: 'Admiralty Way, Lekki',
      lat: 6.4474,
      lng: 3.4723,
      feeMinor: 1_000_000,
      airportCode: null,
    },
  ],
};

describe('rental options (ADR-098)', () => {
  it('reads what a car offers, with money in its currency', () => {
    expect(rentalOptions(STORED)).toEqual({
      extras: [
        { code: 'child_seat', daily: money(200_000n, 'NGN'), max: 2 },
        { code: 'gps', daily: money(150_000n, 'NGN'), max: 1 },
      ],
      crossBorder: { countries: ['BJ', 'GH'], fee: money(5_000_000n, 'NGN') },
      returnBranches: [
        {
          code: 'lekki-branch',
          name: 'Lekki branch',
          address: 'Admiralty Way, Lekki',
          lat: 6.4474,
          lng: 3.4723,
          airportCode: null,
          fee: money(1_000_000n, 'NGN'),
        },
      ],
    });
  });

  it('leaves out anything unreadable instead of failing', () => {
    expect(
      rentalOptions({
        currency: 'NGN',
        extras: [{ code: 'jet_pack', dailyMinor: 1, max: 1 }],
        crossBorder: { countries: ['Benin'], feeMinor: -1 },
        returnBranches: 'everywhere',
      }),
    ).toEqual({ extras: [], crossBorder: null, returnBranches: [] });
    expect(
      rentalOptions({ currency: 'NGN', extras: null, crossBorder: null, returnBranches: null }),
    ).toEqual({ extras: [], crossBorder: null, returnBranches: [] });
    // The same extra twice is a data error: none is offered rather than one at random.
    expect(
      rentalOptions({ ...STORED, extras: [STORED.extras[0], STORED.extras[0]] }).extras,
    ).toEqual([]);
  });

  it('prices a selection: extras per day, the one-way fee and the cross-border fee', () => {
    const options = rentalOptions(STORED);
    expect(rentalOptionCharges(options, NO_RENTAL_SELECTION, 4, false, 'NGN')).toEqual({
      extras: [],
      extrasTotal: money(0n, 'NGN'),
      returnBranch: null,
      oneWay: money(0n, 'NGN'),
      crossBorder: null,
      crossBorderFee: money(0n, 'NGN'),
    });
    expect(
      rentalOptionCharges(
        options,
        {
          extras: [{ code: 'child_seat', quantity: 2 }],
          returnBranch: 'lekki-branch',
          crossBorder: true,
        },
        4,
        false,
        'NGN',
      ),
    ).toEqual({
      extras: [{ code: 'child_seat', quantity: 2, amount: money(1_600_000n, 'NGN') }],
      extrasTotal: money(1_600_000n, 'NGN'),
      returnBranch: {
        code: 'lekki-branch',
        name: 'Lekki branch',
        address: 'Admiralty Way, Lekki',
        lat: 6.4474,
        lng: 3.4723,
        airportCode: null,
      },
      oneWay: money(1_000_000n, 'NGN'),
      crossBorder: { countries: ['BJ', 'GH'] },
      crossBorderFee: money(5_000_000n, 'NGN'),
    });
  });

  it('refuses a branch or a border the car does not offer', () => {
    const options = rentalOptions(STORED);
    expect(
      rentalOptionCharges(
        options,
        { ...NO_RENTAL_SELECTION, returnBranch: 'ikeja-branch' },
        2,
        false,
        'NGN',
      ),
    ).toEqual({ issue: RENTAL_OPTION_ISSUES.returnBranchUnavailable });
    expect(
      rentalOptionCharges(
        { ...options, crossBorder: null },
        { ...NO_RENTAL_SELECTION, crossBorder: true },
        2,
        false,
        'NGN',
      ),
    ).toEqual({ issue: RENTAL_OPTION_ISSUES.crossBorderUnavailable });
    expect(
      rentalOptionCharges(
        options,
        { ...NO_RENTAL_SELECTION, extras: [{ code: 'additional_driver', quantity: 1 }] },
        2,
        false,
        'NGN',
      ),
    ).toEqual({ issue: RENTAL_OPTION_ISSUES.notOffered });
  });

  it('reads a car without weekly or monthly rates as daily only', () => {
    expect(
      rentalRates({
        currency: 'NGN',
        dailyMinor: 4_500_000n,
        weeklyMinor: null,
        monthlyMinor: 90_000_000n,
        chauffeurDailyMinor: null,
        depositMinor: 10_000_000n,
      }),
    ).toEqual({
      daily: money(4_500_000n, 'NGN'),
      weekly: null,
      monthly: money(90_000_000n, 'NGN'),
      chauffeurDaily: null,
      deposit: money(10_000_000n, 'NGN'),
    });
  });
});
