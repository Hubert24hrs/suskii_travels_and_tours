import {
  currencyExponent,
  MAX_TRAVELLERS,
  parsePackagesParams,
  parseToursParams,
  type CurrencyCode,
  type TravellerCounts,
} from '@suskii/shared';

import type { SearchParams } from './search-initial';

/** Two adults: what the packages and tours forms start with. */
const DEFAULT_GROUP: TravellerCounts = { adults: 2, children: 0, infants: 0 };

/** Travellers from a page URL (`adults`, `children`, `infants`), or two adults if not valid. */
export function travellersFrom(query: SearchParams): TravellerCounts {
  const { travellers } = parseToursParams(query).draft;
  const total = travellers.adults + travellers.children + travellers.infants;
  const valid =
    travellers.adults >= 1 && total <= MAX_TRAVELLERS && travellers.infants <= travellers.adults;
  return valid ? travellers : DEFAULT_GROUP;
}

export const travellerQuery = (counts: TravellerCounts): Record<string, string> => ({
  adults: String(counts.adults),
  children: String(counts.children),
  infants: String(counts.infants),
});

/** `?adults=2&children=1` for links to a detail page, so the group carries over. */
export function travellerSuffix(counts: TravellerCounts): string {
  const params = new URLSearchParams({ adults: String(counts.adults) });
  if (counts.children > 0) params.set('children', String(counts.children));
  if (counts.infants > 0) params.set('infants', String(counts.infants));
  return `?${params.toString()}`;
}

export interface CatalogQuery {
  /** Query for the API list route. */
  api: Record<string, string | undefined>;
  travellers: TravellerCounts;
  /** A complete, valid search was made (otherwise the page lists everything on sale). */
  searched: boolean;
}

/**
 * The packages list query from the page URL (`packagesFormToParams`). Budgets are whole units per
 * person in the form; the API takes minor units of the display currency, so a budget also sets
 * the currency prices are shown in.
 */
export function packageListQuery(query: SearchParams, currency: CurrencyCode): CatalogQuery {
  const { form } = parsePackagesParams(query);
  if (!form) return { api: { currency }, travellers: travellersFrom(query), searched: false };
  const { budget } = form;
  const hasBudget = budget.min !== null || budget.max !== null;
  const displayCurrency = hasBudget ? budget.currency : currency;
  const unit = 10 ** currencyExponent(displayCurrency);
  return {
    api: {
      currency: displayCurrency,
      ...travellerQuery(form.travellers),
      cityId: form.cityId,
      ...(form.when.type === 'month'
        ? { month: form.when.month }
        : { from: form.when.from, to: form.when.to }),
      budgetMin: budget.min !== null ? String(budget.min * unit) : undefined,
      budgetMax: budget.max !== null ? String(budget.max * unit) : undefined,
    },
    travellers: form.travellers,
    searched: true,
  };
}

/** The tours list query from the page URL (`toursFormToParams`). */
export function tourListQuery(query: SearchParams, currency: CurrencyCode): CatalogQuery {
  const { form } = parseToursParams(query);
  if (!form) return { api: { currency }, travellers: travellersFrom(query), searched: false };
  return {
    api: { currency, ...travellerQuery(form.travellers), q: form.query, date: form.date },
    travellers: form.travellers,
    searched: true,
  };
}
