/**
 * Company accounts (ADR-078): a company books travel for its people under a travel policy, with
 * approval of trips outside it. Framework-agnostic, so the website's client code can use it
 * through `@suskii/shared/lite`.
 */
import { CABIN_CLASSES, type CabinClass } from './search-limits';

/**
 * A member's role in their company: `admin` runs members and the policy, `approver` decides on
 * trips that need approval and sees every company booking, `booker` books for colleagues and
 * `traveller` books their own trips (both see the company bookings they made).
 */
export const COMPANY_ROLES = ['admin', 'approver', 'booker', 'traveller'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_STATUSES = ['active', 'suspended'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** When a company trip needs an approver before it can be paid. */
export const APPROVAL_MODES = ['never', 'out_of_policy', 'always'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const BOOKING_APPROVAL_STATUSES = [
  'not_required',
  'pending',
  'approved',
  'rejected',
] as const;
export type BookingApprovalStatus = (typeof BOOKING_APPROVAL_STATUSES)[number];

/** What the travel policy found on a trip; codes only. */
export const POLICY_FINDINGS = ['cabin_above_policy', 'hotel_above_cap', 'too_late'] as const;
export type PolicyFinding = (typeof POLICY_FINDINGS)[number];

/** Why an approver said no; codes only, so no free text lands in the record. */
export const APPROVAL_REJECT_REASONS = [
  'over_budget',
  'not_needed',
  'cheaper_option',
  'wrong_details',
  'other',
] as const;
export type ApprovalRejectReason = (typeof APPROVAL_REJECT_REASONS)[number];

export const COMPANY_NAME_MAX = 120;
/** Invitations are valid this long. */
export const COMPANY_INVITATION_DAYS = 7;
export const COMPANY_MAX_ADVANCE_DAYS = 365;

export const canManageCompany = (role: CompanyRole): boolean => role === 'admin';
export const canApprove = (role: CompanyRole): boolean => role === 'admin' || role === 'approver';
/** Admins and approvers see every company booking; others see the ones they made. */
export const seesAllCompanyBookings = (role: CompanyRole): boolean => canApprove(role);

/** A company's travel policy; a field left null does not apply. */
export interface TravelPolicy {
  /** Highest price per night for a stay, in minor units of `hotelNightlyCurrency`. */
  hotelNightlyCapMinor: number | null;
  hotelNightlyCurrency: string | null;
  /** Highest cabin a flight may be booked in. */
  maxCabin: CabinClass | null;
  /** Fewest days between booking and the first travel date. */
  minAdvanceDays: number | null;
  approvalMode: ApprovalMode;
}

/** The facts of a trip the policy is checked against, prepared by the server from the quote. */
export interface TripPolicyFacts {
  /** Cabin of every flight slice. */
  cabins: readonly CabinClass[];
  /** Highest nightly price of any stay, already in the cap's currency; null when there is none. */
  nightlyMinor: number | null;
  /** Whole days from today to the first travel date (negative never happens for a quote). */
  daysInAdvance: number;
}

const cabinRank = (cabin: CabinClass): number => CABIN_CLASSES.indexOf(cabin);

/** What the policy finds on a trip, in a fixed order. */
export function evaluatePolicy(policy: TravelPolicy, facts: TripPolicyFacts): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const maxCabin = policy.maxCabin;
  if (maxCabin && facts.cabins.some((cabin) => cabinRank(cabin) > cabinRank(maxCabin))) {
    findings.push('cabin_above_policy');
  }
  if (
    policy.hotelNightlyCapMinor !== null &&
    facts.nightlyMinor !== null &&
    facts.nightlyMinor > policy.hotelNightlyCapMinor
  ) {
    findings.push('hotel_above_cap');
  }
  if (policy.minAdvanceDays !== null && facts.daysInAdvance < policy.minAdvanceDays) {
    findings.push('too_late');
  }
  return findings;
}

/** Whether a trip with these findings waits for an approver under the company's mode. */
export function needsApproval(mode: ApprovalMode, findings: readonly PolicyFinding[]): boolean {
  if (mode === 'always') return true;
  if (mode === 'out_of_policy') return findings.length > 0;
  return false;
}
