import { describe, expect, it } from 'vitest';

import {
  canApprove,
  canManageCompany,
  evaluatePolicy,
  needsApproval,
  seesAllCompanyBookings,
  type TravelPolicy,
} from './companies';
import { companyInputSchema, travelPolicySchema } from './companies-schemas';

const policy = (overrides: Partial<TravelPolicy> = {}): TravelPolicy => ({
  hotelNightlyCapMinor: null,
  hotelNightlyCurrency: null,
  maxCabin: null,
  minAdvanceDays: null,
  approvalMode: 'out_of_policy',
  ...overrides,
});

describe('company travel policy (ADR-078)', () => {
  it('finds nothing when no rule applies', () => {
    expect(
      evaluatePolicy(policy(), { cabins: ['first'], nightlyMinor: 9e9, daysInAdvance: 0 }),
    ).toEqual([]);
  });

  it('flags a cabin above the highest allowed, on any slice', () => {
    const rules = policy({ maxCabin: 'premium_economy' });
    expect(
      evaluatePolicy(rules, {
        cabins: ['economy', 'premium_economy'],
        nightlyMinor: null,
        daysInAdvance: 30,
      }),
    ).toEqual([]);
    expect(
      evaluatePolicy(rules, {
        cabins: ['economy', 'business'],
        nightlyMinor: null,
        daysInAdvance: 30,
      }),
    ).toEqual(['cabin_above_policy']);
  });

  it('flags a stay above the nightly cap and a booking made too late', () => {
    const rules = policy({
      hotelNightlyCapMinor: 15_000_000,
      hotelNightlyCurrency: 'NGN',
      minAdvanceDays: 7,
    });
    expect(
      evaluatePolicy(rules, { cabins: [], nightlyMinor: 15_000_000, daysInAdvance: 7 }),
    ).toEqual([]);
    expect(
      evaluatePolicy(rules, { cabins: [], nightlyMinor: 15_000_001, daysInAdvance: 6 }),
    ).toEqual(['hotel_above_cap', 'too_late']);
  });

  it('asks for approval according to the mode', () => {
    expect(needsApproval('never', ['too_late'])).toBe(false);
    expect(needsApproval('out_of_policy', [])).toBe(false);
    expect(needsApproval('out_of_policy', ['hotel_above_cap'])).toBe(true);
    expect(needsApproval('always', [])).toBe(true);
  });

  it('gives each role what it needs', () => {
    expect(canManageCompany('admin')).toBe(true);
    expect(canManageCompany('approver')).toBe(false);
    expect(canApprove('approver')).toBe(true);
    expect(canApprove('booker')).toBe(false);
    expect(seesAllCompanyBookings('admin')).toBe(true);
    expect(seesAllCompanyBookings('traveller')).toBe(false);
  });

  it('validates what an admin sends', () => {
    expect(
      companyInputSchema.parse({
        name: '  Acme Logistics ',
        countryCode: 'NG',
        registrationNumber: '',
        billingEmail: 'Finance@Acme.NG',
      }),
    ).toEqual({
      name: 'Acme Logistics',
      countryCode: 'NG',
      registrationNumber: null,
      taxId: null,
      billingEmail: 'finance@acme.ng',
    });
    expect(
      travelPolicySchema.safeParse({
        hotelNightlyCap: { amountMinor: 0, currency: 'NGN' },
        maxCabin: null,
        minAdvanceDays: null,
        approvalMode: 'never',
      }).success,
    ).toBe(false);
    expect(
      travelPolicySchema.safeParse({
        hotelNightlyCap: null,
        maxCabin: 'business',
        minAdvanceDays: 3,
        approvalMode: 'always',
        extra: true,
      }).success,
    ).toBe(false);
  });
});
