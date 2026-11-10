import { tripSearchQuery, type TripComponent, type TripPlan } from '@suskii/shared/lite';

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

const SEARCH_PAGES: Record<TripComponent, { search: string; form: string }> = {
  flight: { search: '/flights/search', form: '/flights' },
  hotel: { search: '/hotels/search', form: '/hotels' },
  car: { search: '/rentals', form: '/rentals' },
  transfer: { search: '/travel-add-ons', form: '/travel-add-ons' },
  insurance: { search: '/travel-add-ons', form: '/travel-add-ons' },
};

/**
 * The ordinary search page for one part of the plan, prefilled with its places, dates and
 * travellers (`tripSearchQuery`); the search form itself when the plan cannot prefill it.
 */
export function tripSearchHref(plan: TripPlan, component: TripComponent): string {
  const query = tripSearchQuery(plan, component);
  const page = SEARCH_PAGES[component];
  return query === null ? page.form : `${page.search}?${query}`;
}
