import type { TripComponent, TripPlan } from '@suskii/shared/lite';

/**
 * The trip a traveller is building (ADR-099), kept in this tab while they choose each part on
 * the ordinary search and checkout pages. Session storage only: it names a trip and a part,
 * never a person, and goes with the tab. Browser-only; storage may be blocked.
 */
const KEY = 'suskii:trip-builder';

/** The part being chosen: checkout adds the booking to this trip instead of taking payment. */
export interface ActiveTrip {
  id: string;
  reference: string;
  component: TripComponent;
}

interface Stored {
  active?: ActiveTrip;
  /** A plan typed before signing in, restored on the way back. */
  draft?: unknown;
}

function read(): Stored {
  try {
    const raw = sessionStorage.getItem(KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
}

function write(next: Stored): void {
  try {
    if (next.active === undefined && next.draft === undefined) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: the part is then booked on its own and can be added from the trip page.
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readActiveTrip(): ActiveTrip | null {
  const { active } = read();
  return active && UUID.test(active.id) && typeof active.reference === 'string' ? active : null;
}

export function setActiveTrip(active: ActiveTrip): void {
  write({ ...read(), active });
}

export function clearActiveTrip(): void {
  const { draft } = read();
  write(draft === undefined ? {} : { draft });
}

export function readPlanDraft<T>(): T | null {
  return (read().draft as T | undefined) ?? null;
}

export function savePlanDraft(draft: unknown): void {
  write({ ...read(), draft });
}

export function clearPlanDraft(): void {
  const { active } = read();
  write(active === undefined ? {} : { active });
}

/** Drops everything, when the traveller signs out. */
export function forgetTripBuilder(): void {
  write({});
}

/** Which part of a trip a quote would be, from what it sells; null for anything a trip skips. */
export function quoteTripComponent(quote: {
  vertical: string;
  addon?: { type?: string } | null;
}): TripComponent | null {
  switch (quote.vertical) {
    case 'flights':
      return 'flight';
    case 'hotels':
      return 'hotel';
    case 'rentals':
      return 'car';
    case 'travel_addons':
      return quote.addon?.type === 'airport_transfer'
        ? 'transfer'
        : quote.addon?.type === 'insurance'
          ? 'insurance'
          : null;
    default:
      return null;
  }
}

const query = (params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) search.set(key, value);
  return search.toString();
};

/** Two adults to a room, as the hotel form starts: the traveller changes rooms on the search. */
function rooms(adults: number): string[] {
  const list: string[] = [];
  for (let left = adults; left > 0; left -= 2) list.push(String(Math.min(left, 2)));
  return list;
}

/** Cars are collected and returned mid-morning unless the traveller says otherwise. */
const HANDOVER = 'T10:00';

/**
 * The ordinary search page for one part of the plan, prefilled with its places, dates and
 * travellers. Children's ages are not in a plan, so the hotel search starts with the adults.
 */
export function tripSearchHref(plan: TripPlan, component: TripComponent): string {
  const { origin, destination, departDate, returnDate, adults, children } = plan;
  const travellers = {
    adults: String(adults),
    children: children > 0 ? String(children) : undefined,
  };
  switch (component) {
    case 'flight':
      return `/flights/search?${query({
        trip: 'round_trip',
        from: origin.code,
        to: destination.code,
        depart: departDate,
        return: returnDate,
        ...travellers,
      })}`;
    case 'hotel': {
      if (!destination.cityId) return '/hotels';
      const search = new URLSearchParams({
        dest: destination.cityId,
        checkin: departDate,
        checkout: returnDate,
      });
      for (const room of rooms(adults)) search.append('room', room);
      return `/hotels/search?${search.toString()}`;
    }
    case 'car':
      return `/rentals?${query({
        city: destination.cityName ?? destination.name,
        pickupAt: `${departDate}${HANDOVER}`,
        returnAt: `${returnDate}${HANDOVER}`,
      })}`;
    case 'transfer':
    case 'insurance':
      if (!destination.cityId) return '/travel-add-ons';
      return `/travel-add-ons?${query({
        type: component === 'transfer' ? 'airport_transfer' : 'insurance',
        dest: destination.cityId,
        start: departDate,
        end: returnDate,
        ...travellers,
      })}`;
  }
}
