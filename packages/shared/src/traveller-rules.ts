/**
 * Flight passenger rules (PROJECT_SPEC.json#/homepage_spec search_module.flights_form):
 * adults 1-9, children aged 2-11, infants under 2, infants <= adults (one lap infant per adult),
 * and at most 9 travellers in total.
 */
export const TRAVELLER_TYPES = ['adults', 'children', 'infants'] as const;
export type TravellerType = (typeof TRAVELLER_TYPES)[number];

export type TravellerCounts = Readonly<Record<TravellerType, number>>;

export const MAX_TRAVELLERS = 9;
export const MIN_ADULTS = 1;

/** Age bands in whole years, inclusive. Infants must be under 2 on the return date too. */
export const TRAVELLER_AGE_BANDS = {
  adults: { min: 12, max: null },
  children: { min: 2, max: 11 },
  infants: { min: 0, max: 1 },
} as const;

export const DEFAULT_TRAVELLERS: TravellerCounts = { adults: 1, children: 0, infants: 0 };

/** Machine-readable issue codes; apps map them to localised messages. */
export const TRAVELLER_ISSUES = {
  infantsExceedAdults: 'infants_exceed_adults',
  tooManyTravellers: 'too_many_travellers',
} as const;

export function totalTravellers(counts: TravellerCounts): number {
  return counts.adults + counts.children + counts.infants;
}

/** Whether adding one traveller of `type` keeps the counts valid. */
export function canIncrement(counts: TravellerCounts, type: TravellerType): boolean {
  if (totalTravellers(counts) >= MAX_TRAVELLERS) {
    return false;
  }
  return type === 'infants' ? counts.infants < counts.adults : true;
}

/** Whether removing one traveller of `type` keeps the counts valid. */
export function canDecrement(counts: TravellerCounts, type: TravellerType): boolean {
  if (type === 'adults') {
    // Never strand a lap infant without an adult.
    return counts.adults > MIN_ADULTS && counts.adults - 1 >= counts.infants;
  }
  return counts[type] > 0;
}

/** Applies a +1/-1 step if the rules allow it; otherwise returns the counts unchanged. */
export function stepTravellers(
  counts: TravellerCounts,
  type: TravellerType,
  delta: 1 | -1,
): TravellerCounts {
  const allowed = delta === 1 ? canIncrement(counts, type) : canDecrement(counts, type);
  return allowed ? { ...counts, [type]: counts[type] + delta } : counts;
}
